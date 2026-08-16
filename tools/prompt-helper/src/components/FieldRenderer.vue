<script setup lang="ts">
// ============================================================
// 动态字段渲染器（FieldRenderer）
// ------------------------------------------------------------
// 职责：根据 FieldMeta.type 渲染不同的输入控件：
//   text     → 单行输入框
//   textarea → 多行文本框（内容像 CSV/JSON 时自动出现表格预览）
//   file     → 拖拽上传区（V1 只记录文件名与大小）
// 额外能力：
//   - multiple 字段：可"添加多份内容"（如贴多份样例数据）
//   - 每个字段右下角可编辑"样板句"（用户改自己的风格，下次生效）
//   - 每个字段可"隐藏"（存到用户偏好）
// 这个组件不认识任何具体业务，只按类型干活——这就是配置驱动的意义。
// ============================================================
import { computed, ref } from 'vue'
import type { FieldMeta, FieldValue, FileMeta } from '@/types/workflow'
import { useWorkflowStore } from '@/stores/workflow'
import { formatFileSize } from '@/utils/format'
import CsvPreview from './CsvPreview.vue'

const props = defineProps<{ recipeId: string; field: FieldMeta }>()
const store = useWorkflowStore()

/** 读草稿里该字段的值（没填过就是空字符串） */
const raw = computed<FieldValue>(
  () => store.draft.stepDrafts[props.recipeId]?.fields[props.field.id] ?? '',
)

/** 写入草稿（自动保存到 localStorage） */
function setValue(v: FieldValue) {
  store.setFieldValue(props.recipeId, props.field.id, v)
}

// ---------- 单份 text / textarea ----------
const singleText = computed<string>({
  get: () => (typeof raw.value === 'string' ? raw.value : ''),
  set: (v) => setValue(v),
})

// ---------- multiple：多份内容（string[]） ----------
// 未填写时显示"一份空输入"，但不写回 store（保持 defaultValue 兜底能力）
const multiArray = computed<string[]>(() => {
  const v = raw.value
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
    return v as string[] // TS 无法自动收窄联合类型，这里显式断言
  }
  return ['']
})

function updateItem(i: number, text: string) {
  const arr = [...multiArray.value]
  arr[i] = text
  setValue(arr)
}
function addItem() {
  setValue([...multiArray.value, ''])
}
function removeItem(i: number) {
  const arr = multiArray.value.filter((_, idx) => idx !== i)
  setValue(arr.length > 0 ? arr : [''])
}

// ---------- file：文件列表（FileMeta[]） ----------
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const fileList = computed<FileMeta[]>(() => {
  const v = raw.value
  return Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' ? (v as FileMeta[]) : []
})

function addFiles(files: File[]) {
  // 只记录元信息，不读文件内容（防止撑爆 localStorage）
  const metas: FileMeta[] = files.map((f) => ({ name: f.name, size: f.size, type: f.type }))
  setValue(props.field.multiple ? [...fileList.value, ...metas] : metas)
}
function removeFile(i: number) {
  setValue(fileList.value.filter((_, idx) => idx !== i))
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) addFiles(files)
  input.value = '' // 清空，允许下次选同一个文件
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length > 0) addFiles(files)
}

// ---------- 样板句编辑（产品"魔法"：改成自己的风格） ----------
const editingSample = ref(false)
const sampleDraft = ref('')

/** 当前生效的样板句：用户改过的优先，否则用配置默认 */
const currentSample = computed(
  () => store.prefs.customDefaults[`${props.recipeId}.${props.field.id}`] ?? props.field.defaultValue,
)

function openSampleEditor() {
  sampleDraft.value = currentSample.value
  editingSample.value = true
}
function saveSample() {
  store.setCustomDefault(props.recipeId, props.field.id, sampleDraft.value)
  editingSample.value = false
}
</script>

<template>
  <div class="field-block">
    <div class="field-label">
      <span>{{ field.label }}</span>
      <span class="fl-actions">
        <button type="button" title="编辑默认样板句" @click="openSampleEditor">样板</button>
        <button type="button" title="在本工作流中隐藏此字段" @click="store.toggleHiddenField(recipeId, field.id)">
          隐藏
        </button>
      </span>
    </div>

    <!-- 单份：单行输入 -->
    <input
      v-if="field.type === 'text' && !field.multiple"
      v-model="singleText"
      class="input"
      :placeholder="field.placeholder"
    />

    <!-- 单份：多行文本 + CSV 表格预览 -->
    <template v-else-if="field.type === 'textarea' && !field.multiple">
      <textarea v-model="singleText" class="textarea" :placeholder="field.placeholder"></textarea>
      <CsvPreview :text="singleText" />
    </template>

    <!-- 多份：text / textarea -->
    <template v-else-if="field.multiple && field.type !== 'file'">
      <div
        v-for="(item, i) in multiArray"
        :key="i"
        style="display: flex; gap: 8px; margin-bottom: 8px"
      >
        <textarea
          v-if="field.type === 'textarea'"
          :value="item"
          class="textarea"
          :placeholder="field.placeholder"
          style="flex: 1"
          @input="updateItem(i, ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <input
          v-else
          :value="item"
          class="input"
          :placeholder="field.placeholder"
          style="flex: 1"
          @input="updateItem(i, ($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="btn btn-ghost btn-sm" title="删除这一份" @click="removeItem(i)">
          删
        </button>
      </div>
      <button type="button" class="add-more" @click="addItem">＋ 添加一份</button>
      <CsvPreview v-if="field.type === 'textarea'" :text="multiArray.join('\n')" />
    </template>

    <!-- 文件上传 -->
    <template v-else-if="field.type === 'file'">
      <div
        class="file-dropzone"
        :class="{ drag: dragging }"
        role="button"
        tabindex="0"
        @click="fileInput?.click()"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        {{ field.placeholder }}
      </div>
      <input
        ref="fileInput"
        type="file"
        :multiple="field.multiple"
        style="display: none"
        @change="onPick"
      />
      <div v-if="fileList.length > 0" class="file-list">
        <div v-for="(f, i) in fileList" :key="i" class="file-chip">
          <span class="fc-name">{{ f.name }}</span>
          <span class="fc-size">{{ formatFileSize(f.size) }}</span>
          <button type="button" class="fc-remove" title="移除" @click="removeFile(i)">×</button>
        </div>
      </div>
    </template>

    <div v-if="field.help" class="field-hint">{{ field.help }}</div>

    <!-- 样板句：展示 + 编辑 -->
    <div class="field-hint">
      <template v-if="!editingSample">
        样板句：{{ currentSample }}
        <button type="button" class="fh-btn" @click="openSampleEditor">编辑</button>
      </template>
      <template v-else>
        <input v-model="sampleDraft" class="input" style="margin-top: 4px" />
        <button type="button" class="fh-btn" @click="saveSample">保存</button>
        <button type="button" class="fh-btn" @click="editingSample = false">取消</button>
      </template>
    </div>
  </div>
</template>
