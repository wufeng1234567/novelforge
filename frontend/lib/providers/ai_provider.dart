import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/ai_service.dart';
import '../services/ai_history_service.dart';

/// AI 服务状态
class AiState {
  final AiServiceStatus status;
  final String currentContent;
  final List<ChatMessage> messages;
  final String? error;
  final String? statusMessage;
  final List<ChatHistory> histories;
  final String? currentHistoryId;

  const AiState({
    this.status = AiServiceStatus.idle,
    this.currentContent = '',
    this.messages = const [],
    this.error,
    this.statusMessage,
    this.histories = const [],
    this.currentHistoryId,
  });

  AiState copyWith({
    AiServiceStatus? status,
    String? currentContent,
    List<ChatMessage>? messages,
    String? error,
    String? statusMessage,
    List<ChatHistory>? histories,
    String? currentHistoryId,
  }) {
    return AiState(
      status: status ?? this.status,
      currentContent: currentContent ?? this.currentContent,
      messages: messages ?? this.messages,
      error: error,
      statusMessage: statusMessage,
      histories: histories ?? this.histories,
      currentHistoryId: currentHistoryId,
    );
  }

  bool get isGenerating =>
      status == AiServiceStatus.connecting ||
      status == AiServiceStatus.generating;
}

/// AI 服务 Provider
class AiNotifier extends StateNotifier<AiState> {
  final AiService _service;
  final AiHistoryService _historyService;

  AiNotifier() : _service = AiService(), _historyService = AiHistoryService(), super(const AiState()) {
    _setupCallbacks();
    _loadHistories();
  }

  void _setupCallbacks() {
    _service.onStatusChanged = (status) {
      state = state.copyWith(status: status, error: null);
    };

    _service.onContentUpdate = (content) {
      state = state.copyWith(currentContent: content);
    };

    _service.onStatusUpdate = (statusMsg) {
      state = state.copyWith(statusMessage: statusMsg);
    };

    _service.onError = (error) {
      state = state.copyWith(error: error);
    };

    _service.onComplete = () {
      state = state.copyWith(
        messages: _service.messages,
        currentContent: '',
        statusMessage: null,
      );
      // 自动保存历史记录
      _saveCurrentChat();
    };
  }

  /// 加载历史记录
  Future<void> _loadHistories() async {
    final histories = await _historyService.getHistories();
    state = state.copyWith(histories: histories);
  }

  /// 保存当前对话到历史记录
  Future<void> _saveCurrentChat() async {
    if (state.messages.isEmpty) return;

    final firstUserMessage = state.messages.firstWhere(
      (m) => m.role == 'user',
      orElse: () => ChatMessage(role: 'user', content: ''),
    );
    if (firstUserMessage.content.isEmpty) return;

    final history = _historyService.createNewHistory(firstUserMessage.content);
    final historyWithMessages = ChatHistory(
      id: state.currentHistoryId ?? history.id,
      title: history.title,
      createdAt: history.createdAt,
      updatedAt: DateTime.now(),
      messages: state.messages.map((m) => ChatHistoryMessage(
        role: m.role,
        content: m.content,
        timestamp: DateTime.now(),
      )).toList(),
    );

    await _historyService.saveHistory(historyWithMessages);
    state = state.copyWith(currentHistoryId: historyWithMessages.id);
    await _loadHistories();
  }

  /// 发送消息
  Future<void> sendMessage(String content, {String? projectId, bool includeContext = false}) async {
    state = state.copyWith(error: null, statusMessage: null);

    // 如果没有当前历史记录ID，创建新的
    if (state.currentHistoryId == null) {
      final history = _historyService.createNewHistory(content);
      state = state.copyWith(currentHistoryId: history.id);
    }

    // 立即添加用户消息到 UI（在服务层处理之前）
    final updatedMessages = [...state.messages, ChatMessage(role: 'user', content: content)];
    state = state.copyWith(messages: updatedMessages);

    await _service.sendMessage(
      content,
      projectId: projectId,
      includeContext: includeContext,
    );
  }

  /// 停止生成
  void stopGeneration() {
    _service.stopGeneration();
  }

  /// 清空对话
  void clearHistory() {
    _service.clearHistory();
    state = const AiState();
  }

  /// 加载历史对话
  Future<void> loadHistory(ChatHistory history) async {
    _service.clearHistory();
    for (final msg in history.messages) {
      _service.messages.add(ChatMessage(role: msg.role, content: msg.content));
    }
    state = state.copyWith(
      messages: _service.messages,
      currentHistoryId: history.id,
      currentContent: '',
      error: null,
      statusMessage: null,
    );
  }

  /// 删除历史记录
  Future<void> deleteHistory(String id) async {
    await _historyService.deleteHistory(id);
    if (state.currentHistoryId == id) {
      state = state.copyWith(currentHistoryId: null);
    }
    await _loadHistories();
  }

  /// 清空所有历史记录
  Future<void> clearAllHistories() async {
    await _historyService.clearHistories();
    state = state.copyWith(histories: []);
  }

  /// 开始新对话
  void startNewChat() {
    _service.clearHistory();
    state = state.copyWith(
      messages: [],
      currentHistoryId: null,
      currentContent: '',
      error: null,
      statusMessage: null,
    );
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }
}

final aiProvider = StateNotifierProvider<AiNotifier, AiState>((ref) {
  return AiNotifier();
});
