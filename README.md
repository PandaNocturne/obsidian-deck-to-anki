# Deck To Anki

Obsidian 插件：把笔记解析成牌组 / 卡片，通过 [AnkiConnect](https://foosoft.net/projects/anki-connect/) 同步到 Anki。

仓库：[PandaNocturne/obsidian-deck-to-anki](https://github.com/PandaNocturne/obsidian-deck-to-anki)  
当前版本：**1.0.0**

## 功能概览

- **四种解析模式**：Head（标题）、List（顶层列表）、Card（`---` 正反面）、File（链接子笔记）
- **同步面板**：当前卡片 / 所有卡片 / 归档卡片；勾选后检测状态并 Force / Update 同步
- **状态颜色**：已同步、被修改、未同步、背面为空、未检测、仅 Anki 存在
- **回链与牌组树**：写入 Anki 字段（oburi / Advanced URI），可配置链接文本
- **扫描范围**：文件夹包含、忽略文件夹、标签限制（支持嵌套标签）
- **媒体**：上传到 Anki 时可压缩图片（不修改库内源文件）

## 依赖

1. [Obsidian](https://obsidian.md) ≥ 1.0.0  
2. [Anki](https://apps.ankiweb.net/) + [AnkiConnect](https://foosoft.net/projects/anki-connect/)（默认 `http://127.0.0.1:8765`）

## 安装

### 手动安装（推荐当前阶段）

1. 打开 [Releases](https://github.com/PandaNocturne/obsidian-deck-to-anki/releases) 下载最新版  
2. 将 `main.js`、`manifest.json`、`styles.css` 放到：

```text
<Vault>/.obsidian/plugins/deck-to-anki/
```

3. 重启 Obsidian，在 **设置 → 社区插件** 中启用 **Deck To Anki**

### 从源码构建

```bash
npm install
npm run build
```

产物同样是根目录的 `main.js`、`manifest.json`、`styles.css`。

## 快速开始

1. 启动 Anki，确认 AnkiConnect 可用  
2. 在笔记 YAML 中声明 `deckType`（见下），或在同步面板里用牌组设置 / Update 写入  
3. 功能区点击 Anki 图标，或命令 **Deck To Anki** 打开同步面板  
4. 勾选卡片 → 检测状态（可选）→ **Update** / **Force** 同步

## 解析模式

| 模式 | 说明 | 笔记 ID 写入位置 |
|------|------|------------------|
| **Head** | 指定层级标题为卡片正面，正文为反面；可用单独一行的 `---` 再拆正反面 | `<!--ID: n-->` |
| **List** | 顶层列表项为正面，缩进内容为反面（反面会去掉一层缩进） | 列表行末尾 `^n` |
| **Card** | 去掉 YAML 后，用单独一行的 `---` 分隔正面与反面；整篇笔记一张卡 | YAML `deckID` |
| **File** | 父笔记通过 wiki 链接组织子笔记，子笔记可再按 head/list/card 解析 | 视子弹笔记模式而定 |

背面为空的卡片：解析后默认不勾选，并以青色 **empty** 状态显示。

## YAML 常用字段

| 字段 | 说明 |
|------|------|
| `deckType` | `head` / `list` / `card` / `file` |
| `deckName` | 牌组显示名（可选） |
| `deckLevel` | Head：卡片标题层级（1–6） |
| `deckStatus` | `false` 学习中；`true` 归档 |
| `deckFile` | File 模式：父笔记索引 `[[父笔记]]` |
| `deckTemplate` | Anki 笔记模板 id |
| `deckNumbering` | 是否同步牌组编号到树字段 |
| `deckID` | Card 模式：Anki note id |

在命令面板可执行：

- **清空当前文件所有 deckID** — 清除 YAML `deckID`、`<!--ID-->`、数字 `^id`
- **清空当前文件所有 deckID 和 deck YAML** — 再清除全部 deck 相关 YAML

## 同步面板

- **当前卡片**：解析活动笔记  
- **所有卡片 / 归档卡片**：按扫描范围扫描库中带 `deckType` 的笔记（默认不自动全选）  
- 工具栏：展开/折叠、全选、检测、刷新、Force、Update  
- 行操作：预览解析、牌组 YAML 设置、单卡同步、勾选  

检测相关选项在 **设置 → 同步 → 检测**（打开当前/所有自动检测、勾选时自动检测、同步前需要检测等）。

## 扫描范围

**设置 → 常规 → 扫描范围**（仅影响「所有 / 归档」扫描）：

1. **扫描文件夹** — 空 = 整个库；可多选，含子文件夹  
2. **忽略文件夹** — 从结果中排除  
3. **标签限制** — 只保留带指定标签的笔记；`anki` 可匹配 `anki/deck`

## 命令

| 命令 | 作用 |
|------|------|
| Deck To Anki | 打开同步弹窗 |
| 打开同步侧边栏 | 打开同步侧边栏视图 |
| 清空当前文件所有 deckID | 见上 |
| 清空当前文件所有 deckID 和 deck YAML | 见上 |

## 设置一览

- **常规**：默认解析模式、标题层级、Wiki 链接、Deck View、扫描范围  
- **同步**：AnkiConnect URL、牌组编号、检测选项、图片压缩  
- **字段**：标签 / 回链 / 牌组树字段开关与回链协议  
- **模板**：内置与自定义 Anki 卡片模板（Front / Back / CSS）

## 开发

```bash
npm install
npm run dev    # watch 编译
npm run build  # 生产构建
npm run lint
```

发布新版本时：

1. 更新 `manifest.json` 的 `version` / `minAppVersion`  
2. `npm version <new>`（会更新 `versions.json`）  
3. `npm run build`  
4. `git push origin <tag>`  
5. `gh release create <tag> main.js manifest.json styles.css`

## License

见仓库 `LICENSE`（若有）。
