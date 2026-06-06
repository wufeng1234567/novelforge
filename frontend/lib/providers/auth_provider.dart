import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:dio/dio.dart';
import '../core/network.dart';

class User {
  final String id;
  final String email;
  final String nickname;
  final String? avatarUrl;
  final DateTime createdAt;

  User({
    required this.id,
    required this.email,
    required this.nickname,
    this.avatarUrl,
    required this.createdAt,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'],
      email: json['email'],
      nickname: json['nickname'],
      avatarUrl: json['avatar_url'],
      createdAt: DateTime.parse(json['created_at']),
    );
  }
}

class AuthState {
  final User? user;
  final bool isLoading;
  final String? error;

  AuthState({this.user, this.isLoading = false, this.error});

  AuthState copyWith({User? user, bool? isLoading, String? error}) {
    return AuthState(
      user: user ?? this.user,
      isLoading: isLoading ?? this.isLoading,
      error: error,
    );
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  final ApiClient _apiClient;

  AuthNotifier(this._apiClient) : super(AuthState()) {
    _loadUser();
  }

  Future<void> _loadUser() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('access_token');
    if (token != null) {
      try {
        final response = await _apiClient.dio.get('/api/v1/auth/me');
        state = state.copyWith(user: User.fromJson(response.data));
      } catch (e) {
        await prefs.remove('access_token');
        await prefs.remove('refresh_token');
      }
    }
  }

  Future<bool> login(String account, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await _apiClient.dio.post(
        '/api/v1/auth/login',
        data: {'account': account, 'password': password},
      );

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', response.data['access_token']);
      await prefs.setString('refresh_token', response.data['refresh_token']);

      final userResponse = await _apiClient.dio.get('/api/v1/auth/me');
      state = state.copyWith(
        user: User.fromJson(userResponse.data),
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      String errorMsg = 'Login failed';
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout) {
        errorMsg = '无法连接到服务器，请检查后端是否启动';
      } else if (e.response?.data != null && e.response?.data['detail'] != null) {
        errorMsg = e.response?.data['detail'];
      } else if (e.message != null) {
        errorMsg = e.message!;
      }
      print('[AUTH] Login error: $errorMsg');  // 调试日志
      state = state.copyWith(
        isLoading: false,
        error: errorMsg,
      );
      return false;
    }
  }

  Future<bool> register(String email, String password, String nickname) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await _apiClient.dio.post(
        '/api/v1/auth/register',
        data: {'email': email, 'password': password, 'nickname': nickname},
      );

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('access_token', response.data['access_token']);
      await prefs.setString('refresh_token', response.data['refresh_token']);

      final userResponse = await _apiClient.dio.get('/api/v1/auth/me');
      state = state.copyWith(
        user: User.fromJson(userResponse.data),
        isLoading: false,
      );
      return true;
    } on DioException catch (e) {
      state = state.copyWith(
        isLoading: false,
        error: e.response?.data['detail'] ?? 'Registration failed',
      );
      return false;
    }
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('access_token');
    await prefs.remove('refresh_token');
    state = AuthState();
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient();
});

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.watch(apiClientProvider));
});
