import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// AI 聊天消息
class ChatMessage {
  final String role; // 'user' 或 'assistant'
  final String content;

  ChatMessage({required this.role, required this.content});

  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

/// AI 服务状态
enum AiServiceStatus {
  idle,
  connecting,
  generating,
  error,
}

/// AI 服务 - 处理与 DeepSeek 的流式通信
class AiService {
  static String get _baseUrl {
    if (Platform.isAndroid) {
      return 'http://192.168.0.105:9000';
    }
    return 'http://localhost:9000';
  }

  final Dio _dio;
  final List<ChatMessage> _messages = [];
  CancelToken? _cancelToken;

  // 状态回调
  Function(AiServiceStatus status)? onStatusChanged;
  Function(String content)? onContentUpdate;
  Function(String status)? onStatusUpdate;
  Function(String error)? onError;
  Function()? onComplete;

  AiServiceStatus _status = AiServiceStatus.idle;
  String _currentContent = '';

  AiService() : _dio = Dio() {
    _dio.options.baseUrl = _baseUrl;
    _dio.options.connectTimeout = const Duration(seconds: 10);
    _dio.options.receiveTimeout = const Duration(minutes: 5);
  }

  AiServiceStatus get status => _status;
  String get currentContent => _currentContent;
  List<ChatMessage> get messages => List.unmodifiable(_messages);

  void _setStatus(AiServiceStatus status) {
    _status = status;
    onStatusChanged?.call(status);
  }

  /// 发送消息并通过扩展获取流式响应
  Future<void> sendMessage(String content, {String? projectId, bool includeContext = false}) async {
    if (_status == AiServiceStatus.connecting || _status == AiServiceStatus.generating) {
      return; // 防止重复发送
    }

    // 添加用户消息到服务层
    _messages.add(ChatMessage(role: 'user', content: content));
    _currentContent = '';
    _setStatus(AiServiceStatus.connecting);

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('access_token');

      final messagesJson = _messages.map((m) => m.toJson()).toList();

      // 使用 extension-chat 端点（通过浏览器扩展获取 DeepSeek 响应）
      final response = await _dio.post(
        '/api/v1/free-deepseek/extension-chat',
        data: {
          'messages': messagesJson,
          'temperature': 0.7,
          'project_id': projectId ?? '',
          'include_context': includeContext,
          'is_continue': false,
        },
        options: Options(
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          responseType: ResponseType.stream,
          sendTimeout: const Duration(seconds: 30),
          receiveTimeout: const Duration(minutes: 5),
        ),
        cancelToken: _cancelToken,
      );

      _setStatus(AiServiceStatus.generating);

      // 处理 SSE 流
      final stream = response.data as ResponseBody;
      String buffer = '';
      int lastNotifyTime = 0;

      await for (final chunk in stream.stream) {
        if (_cancelToken?.isCancelled == true) break;

        final text = utf8.decode(chunk, allowMalformed: true);
        buffer += text;

        // 按行处理
        while (buffer.contains('\n')) {
          final index = buffer.indexOf('\n');
          final line = buffer.substring(0, index).trim();
          buffer = buffer.substring(index + 1);

          if (line.startsWith('data: ')) {
            final data = line.substring(6);

            if (data == '[DONE]') {
              // 流结束
              _messages.add(ChatMessage(role: 'assistant', content: _currentContent));
              _setStatus(AiServiceStatus.idle);
              onComplete?.call();
              return;
            }

            try {
              final json = jsonDecode(data);

              // 处理不同类型的事件
              if (json.containsKey('type')) {
                final type = json['type'] as String;
                if (type == 'waiting') {
                  onStatusUpdate?.call('等待 DeepSeek 页面响应...');
                  continue;
                } else if (type == 'picked_up') {
                  onStatusUpdate?.call('已转发到 DeepSeek 页面，正在输入...');
                  continue;
                } else if (type == 'ds_state') {
                  final state = json['state'] as String;
                  if (state == 'continue') {
                    onStatusUpdate?.call('检测到DS输出暂停，请点击DS页面的继续生成按钮');
                  } else if (state == 'generating') {
                    onStatusUpdate?.call('DeepSeek 正在回复...');
                  }
                  continue;
                }
              }

              if (json.containsKey('error')) {
                final error = json['error'] as String;
                _setStatus(AiServiceStatus.error);
                onError?.call(error);
                return;
              }

              if (json.containsKey('content')) {
                // 后端发的是累积内容，直接替换而非累加
                _currentContent = json['content'] as String;
                // 节流通知：最多每 50ms 更新一次 UI，避免卡死
                final now = DateTime.now().millisecondsSinceEpoch;
                if (now - lastNotifyTime >= 50) {
                  lastNotifyTime = now;
                  onContentUpdate?.call(_currentContent);
                }
              }
            } catch (e) {
              // 忽略 JSON 解析错误
            }
          } else if (line.startsWith(':')) {
            // keepalive comment, ignore
          }
        }
      }

      // 流正常结束但没有收到 [DONE]
      if (_currentContent.isNotEmpty) {
        _messages.add(ChatMessage(role: 'assistant', content: _currentContent));
      }
      _setStatus(AiServiceStatus.idle);
      onComplete?.call();
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) {
        // 用户取消
        if (_currentContent.isNotEmpty) {
          _messages.add(ChatMessage(role: 'assistant', content: _currentContent));
        }
        _setStatus(AiServiceStatus.idle);
        onComplete?.call();
        return;
      }

      String errorMsg = '发送失败';
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        errorMsg = '连接超时，请检查后端服务是否启动';
      } else if (e.type == DioExceptionType.connectionError) {
        errorMsg = '无法连接到服务器，请确保后端已启动 (http://10.0.2.2:8000)';
      } else if (e.response?.statusCode == 429) {
        errorMsg = '请求过于频繁，请等待后重试';
      } else if (e.response?.statusCode == 401) {
        errorMsg = '需要认证，请先登录';
      } else if (e.response?.statusCode == 500) {
        errorMsg = '服务器内部错误: ${e.response?.data?['detail'] ?? '未知错误'}';
      } else if (e.message != null) {
        errorMsg = e.message!;
      }

      _setStatus(AiServiceStatus.error);
      onError?.call(errorMsg);
    } catch (e) {
      _setStatus(AiServiceStatus.error);
      onError?.call('发送失败: $e');
    }
  }

  /// 停止生成
  void stopGeneration() {
    _cancelToken?.cancel('用户取消');
    _cancelToken = CancelToken();
  }

  /// 清空对话历史
  void clearHistory() {
    _messages.clear();
    _currentContent = '';
  }

  /// 释放资源
  void dispose() {
    _cancelToken?.cancel('服务销毁');
    _dio.close();
  }
}
