<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id
</script>

<template>
  <div class="free-mode">
    <div class="view-header">
      <button class="btn-back" @click="router.push(`/project/${projectId}`)">&larr; 返回</button>
      <h2>DeepSeek 免费模式</h2>
    </div>

    <div class="guide-card">
      <div class="step-icon">NF</div>
      <h3>用 DeepSeek 免费生成小说设定</h3>
      <p>通过浏览器扩展，将 DeepSeek 的回复一键导入 NovelForge，自动生成世界观、角色和关系。</p>

      <div class="steps">
        <div class="step">
          <span class="step-num">1</span>
          <div>
            <strong>安装扩展</strong>
            <p>Edge 打开 <code>edge://extensions/</code>，开启「开发者模式」，点「加载已解压的扩展」，选择 <code>extension</code> 文件夹。</p>
          </div>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <div>
            <strong>向 DeepSeek 提问</strong>
            <p>打开 <a href="https://chat.deepseek.com/" target="_blank">chat.deepseek.com</a>，用扩展的「复制提问内容」功能，会自动带上 JSON 格式要求。粘贴到 DeepSeek 发送即可。</p>
          </div>
        </div>
        <div class="step">
          <span class="step-num">3</span>
          <div>
            <strong>复制回复并导入</strong>
            <p>DeepSeek 回复后，复制全部内容，粘贴到扩展面板的文本框，点「解析并导入」。世界观、角色、关系会自动创建。</p>
          </div>
        </div>
      </div>

      <div class="info-box">
        <strong>扩展路径：</strong>
        <code>d:\novelforge\novelforge-app\extension</code>
      </div>

      <div class="features">
        <h4>支持导入的数据</h4>
        <ul>
          <li><strong>世界观模块</strong>：时代背景、地理环境、魔法体系等 9 大类</li>
          <li><strong>硬规则</strong>：世界观中不可违反的设定</li>
          <li><strong>角色</strong>：姓名、外貌、性格、能力、背景等完整信息</li>
          <li><strong>角色关系</strong>：关系类型、亲密度、关系描述</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.free-mode { max-width: 680px; margin: 0 auto; padding: 40px 24px; }
.view-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
.view-header h2 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.btn-back { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 13px; }
.btn-back:hover { color: var(--text); }
.guide-card {
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px;
  padding: 32px;
}
.step-icon {
  width: 52px; height: 52px; border-radius: 10px; background: var(--text);
  color: var(--bg-card); font-size: 18px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 16px; letter-spacing: -0.5px;
}
.guide-card h3 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
.guide-card > p { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
.steps { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
.step { display: flex; gap: 14px; }
.step-num {
  width: 28px; height: 28px; border-radius: 50%; background: var(--bg-hover);
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.step strong { display: block; font-size: 14px; margin-bottom: 4px; }
.step p { font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0; }
.step code {
  padding: 1px 6px; background: var(--bg-hover); border-radius: 4px;
  font-size: 12px; font-family: 'JetBrains Mono', monospace;
}
.step a { color: var(--text); }
.info-box {
  padding: 12px 16px; background: var(--bg-hover); border-radius: 6px;
  font-size: 13px; margin-bottom: 24px;
}
.info-box code {
  padding: 1px 6px; background: var(--bg-card); border-radius: 4px;
  font-size: 12px; font-family: 'JetBrains Mono', monospace;
}
.features h4 { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
.features ul { padding-left: 20px; }
.features li { font-size: 13px; color: var(--text-secondary); line-height: 1.8; }
</style>
