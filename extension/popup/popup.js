const status = document.getElementById('status');
const actions = document.getElementById('actions');

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onDeepSeek = tab?.url?.includes('chat.deepseek.com');

  const tokenRes = await msg('GET_TOKEN');
  const hasToken = !!tokenRes.token;

  if (hasToken) {
    status.textContent = '已连接 NovelForge 后端';
    status.className = 'status ok';
  } else {
    status.textContent = '未连接后端（在 DeepSeek 页面登录）';
    status.className = 'status err';
  }

  if (onDeepSeek) {
    actions.innerHTML = `
      <div style="font-size:12px;color:#16a34a;text-align:center;margin-bottom:8px">已在 DeepSeek 页面</div>
      <div style="font-size:11px;color:#737373;text-align:center">点击页面右下角 <b>NF</b> 按钮打开助手</div>
    `;
  } else {
    actions.innerHTML = `
      <button class="btn btn-primary" id="go-ds">打开 DeepSeek</button>
    `;
    document.getElementById('go-ds').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://chat.deepseek.com/' });
    });
  }
}

function msg(type, data = {}) {
  return new Promise(resolve => chrome.runtime.sendMessage({ type, ...data }, resolve));
}

init();
