import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// 全局错误信息存储
class ErrorStore {
  static final List<ErrorEntry> _errors = [];
  static final ValueNotifier<int> errorCount = ValueNotifier(0);
  static bool _notifying = false;

  static List<ErrorEntry> get errors => List.unmodifiable(_errors);

  static void addError(Object error, StackTrace? stackTrace) {
    // 避免在 build 期间递归触发
    if (_notifying) return;

    _errors.insert(0, ErrorEntry(
      error: error,
      stackTrace: stackTrace,
      timestamp: DateTime.now(),
    ));
    if (_errors.length > 50) {
      _errors.removeLast();
    }

    // 延迟通知，避免在 build 期间调用
    if (!_notifying) {
      _notifying = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _notifying = false;
        errorCount.value = _errors.length;
      });
    }
  }

  static void clear() {
    _errors.clear();
    errorCount.value = 0;
  }
}

class ErrorEntry {
  final Object error;
  final StackTrace? stackTrace;
  final DateTime timestamp;

  ErrorEntry({
    required this.error,
    this.stackTrace,
    required this.timestamp,
  });

  String get formattedTime {
    return '${timestamp.hour.toString().padLeft(2, '0')}:'
           '${timestamp.minute.toString().padLeft(2, '0')}:'
           '${timestamp.second.toString().padLeft(2, '0')}';
  }

  String get fullReport {
    final buffer = StringBuffer();
    buffer.writeln('═══════════════════════════════════════════');
    buffer.writeln('时间: $formattedTime');
    buffer.writeln('───────────────────────────────────────────');
    buffer.writeln('错误: $error');
    if (stackTrace != null) {
      buffer.writeln('───────────────────────────────────────────');
      buffer.writeln('堆栈:');
      buffer.writeln(stackTrace.toString());
    }
    buffer.writeln('═══════════════════════════════════════════');
    return buffer.toString();
  }
}

/// 全局错误覆盖层
class ErrorOverlay extends StatefulWidget {
  final Widget child;

  const ErrorOverlay({super.key, required this.child});

  @override
  State<ErrorOverlay> createState() => _ErrorOverlayState();
}

class _ErrorOverlayState extends State<ErrorOverlay> {
  bool _showPanel = false;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Material(
        type: MaterialType.transparency,
        child: Stack(
          children: [
            widget.child,

            // 错误按钮（右下角悬浮）
            Positioned(
              right: 16,
              bottom: 80,
              child: ValueListenableBuilder<int>(
                valueListenable: ErrorStore.errorCount,
                builder: (context, errorCount, _) {
                  return GestureDetector(
                    onTap: () {
                      setState(() {
                        _showPanel = !_showPanel;
                      });
                    },
                    onLongPress: () => _copyAllErrors(context),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: errorCount > 0
                            ? Colors.red.shade600
                            : Colors.grey.shade700,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.3),
                            blurRadius: 8,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Icon(
                            _showPanel ? Icons.close : Icons.bug_report,
                            color: Colors.white,
                            size: 24,
                          ),
                          if (errorCount > 0)
                            Positioned(
                              right: -8,
                              top: -8,
                              child: Container(
                                padding: const EdgeInsets.all(4),
                                decoration: const BoxDecoration(
                                  color: Colors.white,
                                  shape: BoxShape.circle,
                                ),
                                constraints: const BoxConstraints(
                                  minWidth: 18,
                                  minHeight: 18,
                                ),
                                child: Text(
                                  '$errorCount',
                                  style: TextStyle(
                                    color: Colors.red.shade700,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),

            // 错误面板
            if (_showPanel)
              Positioned(
                right: 16,
                bottom: 140,
                child: _buildErrorPanel(),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorPanel() {
    final errors = ErrorStore.errors;

    return Container(
      width: 320,
      height: 400,
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E1E),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.5),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // 标题栏
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.red.shade900,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            ),
            child: Row(
              children: [
                const Icon(Icons.bug_report, color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Text(
                  '错误日志 (${errors.length})',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
                const Spacer(),
                // 复制按钮
                GestureDetector(
                  onTap: () => _copyAllErrors(context),
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    child: const Icon(Icons.copy, color: Colors.white, size: 18),
                  ),
                ),
                // 清空按钮
                GestureDetector(
                  onTap: () {
                    ErrorStore.clear();
                  },
                  child: Container(
                    padding: const EdgeInsets.all(6),
                    child: const Icon(Icons.delete, color: Colors.white, size: 18),
                  ),
                ),
              ],
            ),
          ),

          // 错误列表
          Expanded(
            child: errors.isEmpty
                ? const Center(
                    child: Text(
                      '暂无错误',
                      style: TextStyle(color: Colors.grey),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.all(8),
                    itemCount: errors.length,
                    itemBuilder: (context, index) {
                      return _buildErrorItem(errors[index]);
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorItem(ErrorEntry entry) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.3),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red.shade800.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 时间和操作
          Row(
            children: [
              Text(
                entry.formattedTime,
                style: TextStyle(
                  color: Colors.grey.shade500,
                  fontSize: 11,
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () => _copyError(entry),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade700.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    '复制',
                    style: TextStyle(color: Colors.white, fontSize: 10),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),

          // 错误信息
          Text(
            entry.error.toString(),
            style: const TextStyle(
              color: Colors.redAccent,
              fontSize: 12,
              fontFamily: 'monospace',
            ),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
          ),

          // 堆栈（可展开）
          if (entry.stackTrace != null)
            Theme(
              data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
              child: ExpansionTile(
                tilePadding: EdgeInsets.zero,
                childrenPadding: const EdgeInsets.only(top: 4),
                title: Text(
                  '查看堆栈',
                  style: TextStyle(
                    color: Colors.grey.shade400,
                    fontSize: 11,
                  ),
                ),
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: SelectableText(
                      entry.stackTrace.toString(),
                      style: const TextStyle(
                        color: Colors.grey,
                        fontSize: 10,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  void _copyError(ErrorEntry entry) {
    Clipboard.setData(ClipboardData(text: entry.fullReport));
    _showToast('已复制到剪贴板');
  }

  void _copyAllErrors(BuildContext context) {
    final allErrors = ErrorStore.errors.map((e) => e.fullReport).join('\n');
    if (allErrors.isEmpty) {
      _showToast('暂无错误');
      return;
    }
    Clipboard.setData(ClipboardData(text: allErrors));
    _showToast('已复制 ${ErrorStore.errors.length} 条错误');
  }

  void _showToast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 1),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
