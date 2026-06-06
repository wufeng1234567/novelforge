import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

/// AI 聊天历史记录
class ChatHistory {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<ChatHistoryMessage> messages;

  ChatHistory({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    required this.messages,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'createdAt': createdAt.toIso8601String(),
    'updatedAt': updatedAt.toIso8601String(),
    'messages': messages.map((m) => m.toJson()).toList(),
  };

  factory ChatHistory.fromJson(Map<String, dynamic> json) => ChatHistory(
    id: json['id'],
    title: json['title'],
    createdAt: DateTime.parse(json['createdAt']),
    updatedAt: DateTime.parse(json['updatedAt']),
    messages: (json['messages'] as List).map((m) => ChatHistoryMessage.fromJson(m)).toList(),
  );
}

/// 聊天历史消息
class ChatHistoryMessage {
  final String role;
  final String content;
  final DateTime timestamp;

  ChatHistoryMessage({
    required this.role,
    required this.content,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'role': role,
    'content': content,
    'timestamp': timestamp.toIso8601String(),
  };

  factory ChatHistoryMessage.fromJson(Map<String, dynamic> json) => ChatHistoryMessage(
    role: json['role'],
    content: json['content'],
    timestamp: DateTime.parse(json['timestamp']),
  );
}

/// AI 历史记录服务
class AiHistoryService {
  static const String _historyKey = 'ai_chat_history';
  static const int _maxHistoryCount = 50;

  /// 获取所有历史记录
  Future<List<ChatHistory>> getHistories() async {
    final prefs = await SharedPreferences.getInstance();
    final String? data = prefs.getString(_historyKey);
    if (data == null) return [];

    try {
      final List<dynamic> jsonList = jsonDecode(data);
      return jsonList.map((json) => ChatHistory.fromJson(json)).toList()
        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    } catch (e) {
      return [];
    }
  }

  /// 保存历史记录
  Future<void> saveHistory(ChatHistory history) async {
    final histories = await getHistories();

    // 检查是否已存在，更新
    final index = histories.indexWhere((h) => h.id == history.id);
    if (index >= 0) {
      histories[index] = history;
    } else {
      histories.insert(0, history);
    }

    // 限制最大数量
    if (histories.length > _maxHistoryCount) {
      histories.removeRange(_maxHistoryCount, histories.length);
    }

    await _saveHistories(histories);
  }

  /// 删除历史记录
  Future<void> deleteHistory(String id) async {
    final histories = await getHistories();
    histories.removeWhere((h) => h.id == id);
    await _saveHistories(histories);
  }

  /// 清空所有历史记录
  Future<void> clearHistories() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_historyKey);
  }

  /// 创建新的历史记录
  ChatHistory createNewHistory(String firstMessage) {
    final now = DateTime.now();
    return ChatHistory(
      id: now.millisecondsSinceEpoch.toString(),
      title: _generateTitle(firstMessage),
      createdAt: now,
      updatedAt: now,
      messages: [],
    );
  }

  /// 生成标题（取前20个字符）
  String _generateTitle(String content) {
    if (content.length <= 20) return content;
    return '${content.substring(0, 20)}...';
  }

  Future<void> _saveHistories(List<ChatHistory> histories) async {
    final prefs = await SharedPreferences.getInstance();
    final String data = jsonEncode(histories.map((h) => h.toJson()).toList());
    await prefs.setString(_historyKey, data);
  }
}
