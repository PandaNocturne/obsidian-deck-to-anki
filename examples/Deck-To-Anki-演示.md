---
deckType: head
deckName: Deck To Anki 演示
deckLevel: 3
deckStatus: false
deckTemplate: ob-deck-basic
deckNumbering: true
tags:
  - deck-to-anki/demo
---

# Deck To Anki 演示

把本笔记复制到你的库中，启动 Anki + AnkiConnect，打开同步面板即可试用。

- **H1**：牌组根名（唯一 H1 会被折叠进根）
- **H2**：子牌组
- **H3**：卡片（`deckLevel: 3`）
- 标题下正文 → 背面；有单独一行的 `---` 时，上方为正面补充、下方为背面

## 快速开始

### 这是什么插件？

把 Obsidian 笔记解析成牌组 / 卡片，通过 AnkiConnect 同步到 Anki。笔记仍留在库里，Anki 负责复习。

### 功能概述

- **快速制卡**：在 Obsidian 中直接写笔记即可生成 Anki 问答卡，无需切换工具
- **可翻转问答卡**：支持翻转模板（如内置的 `ob-deck-basic++`），正反面互换复习
- **富内容支持**：图片、公式、表格、Obsidian Tags 均可保留在卡片中
- **回链支持**：可写入 Anki 字段，通过 ObURI 或 Advanced URI 插件一键点回 Obsidian 原文
- **解析 wiki 链接**：支持 `[[笔记]]`、`![[图片]]` 等链接与嵌入
- **多种解析模式**：head / list / card / file，适配不同笔记习惯

### 开始前需要准备什么？

1. Obsidian ≥ 1.0.0，并启用本插件（Deck To Anki）
2. Anki + [AnkiConnect](https://foosoft.net/projects/anki-connect/)（默认 `http://127.0.0.1:8765`）
3. 需要制卡的笔记
4. 在需要制卡笔记中打开，打开 Deck To Anki 面板即可
5. 其余设置都可以在面板中直接操作，之后一键同步到 Anki

### 如何打开同步面板？

- 功能区点击 Anki 图标，或
- 命令面板执行 **Deck To Anki**

面板里可：预览解析、勾选卡片、检测状态、**Update** / **Force** 同步。

### 第一次同步建议怎么做？

1. 打开本笔记 → 打开同步面板（当前卡片）
2. 点行上的预览，确认正反面
3. 勾选卡片 →（可选）检测 → **Update**

同步成功后，Head 模式会在卡片附近写入 `<!--ID: …-->`。

## 解析模式

### Head 模式

`deckType: head`

由标题层级组织牌组结构，需配合 `deckLevel` 使用（本演示即 `deckType: head` + `deckLevel: 3`）：

- 低于卡片层级的标题（H2）→ 子牌组
- 等于 `deckLevel` 的标题（H3）→ 卡片标题（写入 Anki `ob-deck-head`）
- 更深的标题（H4+）→ 不单独成卡，可写在正文里

标题下的正文默认成为**背面**；有单独一行的 `---` 时，上方为**正面补充**、下方为**背面**。ID 同步后写入卡片附近的 HTML 注释：`<!--ID: …-->`。

### List 模式

`deckType: list`

顶层列表项为正面，缩进内容为背面。ID 写在列表行末：`^noteId`。

### Card 模式

`deckType: card`

整篇笔记一张卡：去掉 YAML 后，用单独一行的 `---` 分成正面 / 背面。ID 在 YAML：`deckID`。

### File 模式

`deckType: file`

父笔记用 wiki 链接组织子笔记；子笔记再按 head / list / card 解析，并用 `deckFile` 指回父笔记。

## 同步面板与状态

### 同步面板有哪些视图？

- **当前卡片**：解析活动笔记
- **所有卡片 / 归档卡片**：按扫描范围扫描带 `deckType` 的笔记
- 行操作：Deck View 预览、牌组 YAML 设置、单卡同步、勾选

### 状态颜色大概表示什么？

| 状态    | 含义                   |
| ------- | ---------------------- |
| 已同步  | 与 Anki 一致           |
| 被修改  | 本地相对 Anki 有变更   |
| 未同步  | 尚未推送到 Anki        |
| empty   | 背面为空（默认不勾选） |
| 未检测  | 尚未对比 Anki          |
| 仅 Anki | Anki 有、本地无        |

### Update 和 Force 有什么区别？

**Update**：按检测结果同步有变化的内容  
**Force**：强制推送（含模板样式等需要刷新时）

日常改笔记内容用 Update；改了模板 HTML/CSS 后可用 Force 或设置里「发送到 Anki」。

## Head 模式规则讲解

### Head 模式的层级规则是什么？

`deckLevel` 指定「哪一级标题是卡片」。本演示为 `3`：

- **低于卡片层级**的标题（如 H2）→ 子牌组
- **等于** `deckLevel` 的标题（H3）→ 卡片标题（写入 Anki `ob-deck-head`）
- **更深**的标题（H4+）→ 不单独成卡，可写在正文里

### 没有 `---` 时，正反面如何划分？

标题下的全部正文都会成为**背面**；正面正文（`ob-deck-front`）为空，标题仍在 `ob-deck-head`。

---

适合「标题即问题、正文即答案」的笔记。本小节上面的分隔线演示了另一种写法。

### 有 `---` 时，正反面如何划分？

单独一行的 `---` 上方 → 正面补充（`ob-deck-front`）  
`---` 下方 → 背面（`ob-deck-back`）

标题始终在 `ob-deck-head`（除非设置里打开「标题写入正面」）

---

可在正面写提示、题干补充，背面写完整答案。

## 常用 YAML 字段

### 本文件用到了哪些 YAML？

| 字段            | 本文件取值        | 作用                    |
| --------------- | ----------------- | ----------------------- |
| `deckType`      | `head`            | 解析模式                |
| `deckName`      | Deck To Anki 演示 | 根牌组名                |
| `deckLevel`     | `3`               | H3 为卡片               |
| `deckStatus`    | `false`           | 学习中（`true` = 归档） |
| `deckTemplate`  | `ob-deck-basic`   | Anki 笔记类型           |
| `deckNumbering` | `true`            | 树字段显示牌组序号      |

### 翻转卡片怎么开？

在模板设置里为笔记类型开启「是否翻转」，并编辑**翻转正面 / 翻转背面 HTML**。  
也可使用内置的 `ob-deck-basic++`。

翻转模板需自行指定用哪些字段当问题 / 答案（例如背面字段作翻转正面）。

## 设置与扩展

### 扫描范围在哪里配？

**设置 → 常规 → 扫描范围**（影响「所有 / 归档」）：

1. 扫描文件夹（空 = 全库）
2. 忽略文件夹
3. 标签限制（如 `deck-to-anki` 可匹配本页的 `deck-to-anki/demo`）

### 回链和牌组树是什么？

同步时可写入 Anki 字段：

- **ob-deck-tree**：牌组路径面包屑
- **ob-deck-backlink**：点回 Obsidian 当前卡片

可在 **设置 → 字段** 中开关，并选择 oburi / Advanced URI。

### 图片会怎样处理？

开启媒体压缩后，**上传到 Anki 时**可压缩图片；**不会修改**库内源文件。

## 试试这些操作

### 建议你亲手点哪些功能？

1. 打开 **Deck View**，看「正面」是否已把标题与正面合并显示
2. 打开 **Deck YAML Setting**，改 `deckName` 或关闭 numbering 再同步
3. 故意清空某张卡的背面 → 应显示 **empty** 且默认不勾选
4. 同步后再改答案 → 检测应为「被修改」，Update 可更新 Anki

### 演示笔记用完可以怎样清理？

命令面板：

- **清空当前文件所有 deckID** — 只清 ID，保留 YAML
- **清空当前文件所有 deckID 和 deck YAML** — 连同 deck 属性一起清除

也可在 Anki 中删除对应牌组 `Deck To Anki 演示`。
