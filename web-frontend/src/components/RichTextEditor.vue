<script setup>
import { onBeforeUnmount, watch, defineExpose } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'

const props = defineProps({
  content: { type: String, default: '' }
})

const emit = defineEmits(['update'])

function textToHtml(text) {
  if (!text.includes('\n')) return text
  const lines = text.split('\n\n')
  const html = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed) return ''
    return '<p>' + trimmed.replace(/\n/g, '<br>') + '</p>'
  }).join('')
  return html || text
}

// ---- 自定义选区高亮（失焦不消失） ----
let savedSelection = null

const PersistentSelection = Extension.create({
  name: 'persistentSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('persistentSelection'),
        state: {
          init() { return DecorationSet.empty },
          apply(tr, oldDeco) {
            const sel = tr.selection
            if (sel.from !== sel.to) {
              // 有选区 → 更新装饰器
              savedSelection = { from: sel.from, to: sel.to }
              const deco = Decoration.inline(sel.from, sel.to, { class: 'persistent-selection' })
              return DecorationSet.create(tr.doc, [deco])
            }
            // 选区折叠 → 保留旧装饰器（不删除）
            return oldDeco.map(tr.mapping, tr.doc)
          }
        },
        props: {
          decorations(state) { return this.getState(state) }
        }
      })
    ]
  }
})

const editor = useEditor({
  content: textToHtml(props.content),
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: '开始写作...' }),
    CharacterCount,
    Underline,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight,
    PersistentSelection
  ],
  onUpdate({ editor }) {
    emit('update', {
      html: editor.getHTML(),
      text: editor.getText()
    })
  }
})

watch(() => props.content, (val) => {
  if (editor.value && val !== editor.value.getHTML()) {
    editor.value.commands.setContent(textToHtml(val))
  }
})

function insertContent(text) {
  if (editor.value) {
    const html = textToHtml(text)
    editor.value.chain().focus().insertContent(html).run()
  }
}

function replaceSelection(text) {
  if (!editor.value) return
  const html = textToHtml(text)
  let { from, to } = editor.value.state.selection

  // 当前无选区时，使用保存的选区（由装饰器维护）
  if (from === to && savedSelection) {
    from = savedSelection.from
    to = savedSelection.to
  }

  // 清除保存的选区
  savedSelection = null

  if (from !== to) {
    editor.value.chain().focus()
      .setTextSelection({ from, to })
      .deleteSelection()
      .insertContent(html)
      .run()
  } else {
    editor.value.chain().focus().insertContent(html).run()
  }
}

defineExpose({ insertContent, replaceSelection })

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="rich-editor" v-if="editor">
    <!-- Toolbar -->
    <div class="toolbar">
      <button
        @click="editor.chain().focus().toggleBold().run()"
        :class="{ active: editor.isActive('bold') }"
        title="粗体"
      ><b>B</b></button>
      <button
        @click="editor.chain().focus().toggleItalic().run()"
        :class="{ active: editor.isActive('italic') }"
        title="斜体"
      ><i>I</i></button>
      <button
        @click="editor.chain().focus().toggleUnderline().run()"
        :class="{ active: editor.isActive('underline') }"
        title="下划线"
      ><u>U</u></button>
      <button
        @click="editor.chain().focus().toggleStrike().run()"
        :class="{ active: editor.isActive('strike') }"
        title="删除线"
      ><s>S</s></button>
      <span class="divider"></span>
      <button
        @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        :class="{ active: editor.isActive('heading', { level: 1 }) }"
        title="标题1"
      >H1</button>
      <button
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        :class="{ active: editor.isActive('heading', { level: 2 }) }"
        title="标题2"
      >H2</button>
      <button
        @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        :class="{ active: editor.isActive('heading', { level: 3 }) }"
        title="标题3"
      >H3</button>
      <span class="divider"></span>
      <button
        @click="editor.chain().focus().toggleBulletList().run()"
        :class="{ active: editor.isActive('bulletList') }"
        title="无序列表"
      >&#8226; 列表</button>
      <button
        @click="editor.chain().focus().toggleOrderedList().run()"
        :class="{ active: editor.isActive('orderedList') }"
        title="有序列表"
      >1. 列表</button>
      <button
        @click="editor.chain().focus().toggleBlockquote().run()"
        :class="{ active: editor.isActive('blockquote') }"
        title="引用"
      >&#10077; 引用</button>
      <button
        @click="editor.chain().focus().toggleCodeBlock().run()"
        :class="{ active: editor.isActive('codeBlock') }"
        title="代码块"
      >{ } 代码</button>
      <span class="divider"></span>
      <button @click="editor.chain().focus().setHorizontalRule().run()" title="分割线">— 横线</button>
      <button @click="editor.chain().focus().undo().run()" title="撤销">&#8617;</button>
      <button @click="editor.chain().focus().redo().run()" title="重做">&#8618;</button>
    </div>
    <!-- Editor Content -->
    <EditorContent :editor="editor" class="editor-content" />
  </div>
</template>

<style scoped>
.rich-editor {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-card);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  padding: 6px 10px;
  background: var(--bg-hover);
  border-bottom: 1px solid var(--border);
}
.toolbar button {
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  transition: all 0.1s;
}
.toolbar button:hover { background: var(--bg-card); color: var(--text); }
.toolbar button.active {
  background: var(--text);
  color: var(--bg-card);
}
.toolbar .divider {
  width: 1px;
  background: var(--border);
  margin: 0 6px;
}
.editor-content {
  min-height: 400px;
}
.editor-content :deep(.tiptap) {
  padding: 20px 32px;
  min-height: 400px;
  outline: none;
  font-size: 16px;
  line-height: 1.9;
  color: var(--text);
}
.editor-content :deep(.tiptap p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #a3a3a3;
  pointer-events: none;
  height: 0;
  font-style: italic;
}
.editor-content :deep(.tiptap h1) { font-size: 26px; font-weight: 700; margin: 20px 0 8px; letter-spacing: -0.5px; }
.editor-content :deep(.tiptap h2) { font-size: 21px; font-weight: 600; margin: 16px 0 6px; letter-spacing: -0.3px; }
.editor-content :deep(.tiptap h3) { font-size: 17px; font-weight: 600; margin: 14px 0 4px; }
.editor-content :deep(.tiptap blockquote) {
  border-left: 3px solid var(--border-hover);
  padding-left: 16px;
  color: var(--text-secondary);
  margin: 12px 0;
}
.editor-content :deep(.tiptap pre) {
  background: var(--bg-code);
  padding: 12px 16px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  overflow-x: auto;
}
.editor-content :deep(.tiptap mark) {
  background-color: #fef9c3;
  padding: 0 2px;
  border-radius: 2px;
}
.editor-content :deep(.persistent-selection) {
  background-color: rgba(128, 128, 128, 0.25);
  border-radius: 2px;
}
</style>
