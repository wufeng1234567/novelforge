import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/auth_provider.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final user = authState.user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('NovelForge'),
        actions: [
          if (user != null)
            PopupMenuButton<String>(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 16,
                      child: Text(user.nickname.isNotEmpty ? user.nickname[0].toUpperCase() : '?'),
                    ),
                    const SizedBox(width: 8),
                    Text(user.nickname),
                  ],
                ),
              ),
              onSelected: (value) {
                if (value == 'logout') {
                  ref.read(authProvider.notifier).logout();
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  value: 'profile',
                  child: ListTile(
                    leading: const Icon(Icons.person),
                    title: Text(user.email),
                    subtitle: const Text('个人资料'),
                  ),
                ),
                const PopupMenuItem(
                  value: 'logout',
                  child: ListTile(
                    leading: Icon(Icons.logout),
                    title: Text('退出登录'),
                  ),
                ),
              ],
            )
          else
            TextButton(
              onPressed: () => context.go('/login'),
              child: const Text('登录'),
            ),
        ],
      ),
      body: user == null
          ? _buildGuestView(context)
          : _buildUserView(context, user.nickname),
    );
  }

  Widget _buildGuestView(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.auto_stories,
            size: 80,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(height: 24),
          Text(
            '欢迎使用 NovelForge',
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'AI智能小说创作工作台',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 48),
          SizedBox(
            width: 200,
            height: 48,
            child: ElevatedButton.icon(
              onPressed: () => context.go('/login'),
              icon: const Icon(Icons.login),
              label: const Text('开始创作'),
            ),
          ),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () => context.go('/register'),
            child: const Text('注册新账号'),
          ),
        ],
      ),
    );
  }

  Widget _buildUserView(BuildContext context, String nickname) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Welcome section
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '你好，$nickname',
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '准备好开始你的创作之旅了吗？',
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.waving_hand,
                    size: 48,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Quick actions
          Text(
            '快速开始',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: MediaQuery.of(context).size.width > 800 ? 4 : 2,
            mainAxisSpacing: 16,
            crossAxisSpacing: 16,
            childAspectRatio: 1.2,
            children: [
              _buildActionCard(
                context,
                icon: Icons.add_circle_outline,
                title: '新建项目',
                subtitle: '创建一个新小说项目',
                color: Colors.blue,
                onTap: () {
                  // TODO: Navigate to create project
                },
              ),
              _buildActionCard(
                context,
                icon: Icons.library_books_outlined,
                title: '我的项目',
                subtitle: '查看和管理项目',
                color: Colors.green,
                onTap: () {
                  // TODO: Navigate to project list
                },
              ),
              _buildActionCard(
                context,
                icon: Icons.psychology_outlined,
                title: 'AI助手',
                subtitle: '与AI对话',
                color: Colors.purple,
                onTap: () => context.push('/ai-chat'),
              ),
              _buildActionCard(
                context,
                icon: Icons.search,
                title: '语义搜索',
                subtitle: '搜索你的创作内容',
                color: Colors.orange,
                onTap: () {
                  // TODO: Navigate to search
                },
              ),
            ],
          ),
          const SizedBox(height: 24),

          // Features section
          Text(
            '核心功能',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          _buildFeatureItem(
            context,
            icon: Icons.edit_note,
            title: '智能编辑器',
            subtitle: 'Markdown编辑器，支持实时预览和AI辅助',
          ),
          _buildFeatureItem(
            context,
            icon: Icons.public,
            title: '世界观构建',
            subtitle: '9大模块，超凡等级系统，构建完整世界观',
          ),
          _buildFeatureItem(
            context,
            icon: Icons.people_outline,
            title: '角色管理',
            subtitle: '角色卡片、关系图谱、事件追踪',
          ),
          _buildFeatureItem(
            context,
            icon: Icons.device_hub,
            title: '版本分支',
            subtitle: '多版本管理，分支剧情，随时回滚',
          ),
        ],
      ),
    );
  }

  Widget _buildActionCard(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 40, color: color),
              const SizedBox(height: 12),
              Text(
                title,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFeatureItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Icon(icon, color: Theme.of(context).colorScheme.primary),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.arrow_forward_ios, size: 16),
      ),
    );
  }
}
