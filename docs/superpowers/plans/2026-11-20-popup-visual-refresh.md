# QQ 相册下载弹窗视觉改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将扩展弹窗改成醒目的 QQ 空间蓝底黄按钮风格，同时保留现有下载行为。

**Architecture:** 沿用现有静态 HTML、CSS 和 popup.js 状态更新方式。调整弹窗的视觉结构与样式，保留 `popup.js` 使用的 DOM ID、状态 class 和下载流程。

**Tech Stack:** Chrome Extension Manifest V3、原生 HTML、CSS、JavaScript。

**Spec:** `docs/superpowers/specs/2026-11-20-popup-visual-refresh-design.md`

## Global Constraints

- 不新增下载历史、取消操作或缩略图获取。
- 不使用远程图片或外部字体；不展示并不存在的照片缩略图。
- 保留当前数量输入、开始下载、进度、完成与错误状态。
- 保持键盘焦点可见，并尊重系统的减少动态效果设置。

## Review Focus

- 初始弹窗在 360px 宽度内布局完整，不出现横向溢出。
- 相册名较长时仍可读，且不会推挤数量设置和主按钮。
- 下载进度、完成、警告与错误状态在蓝色背景上保持对比度。
- 键盘焦点边框在蓝黄配色上清晰可见。
- 减少动态效果偏好下不保留非必要过渡动画。

---

### Task 1: 更新弹窗视觉结构与样式

**Files:**
- Modify: `src/popup.html`
- Modify: `src/styles.css`
- Reference: `src/popup.js`（保留其使用的 `downloadAblum`、`downloadBox`、`statusTitle`、`albumTitle`、`progressText`、`progressBar`、`statusMessage` ID，以及 `is-complete`、`is-warning` 状态 class）

**Interfaces:**
- Consumes: 现有 popup HTML 元素和下载状态 class。
- Produces: 同一组元素在蓝色封面式视觉系统中的呈现，不改变 JavaScript 行为。

- [x] 在 `src/popup.html` 中整理语义分区，保留现有控件和状态 ID；加入装饰性相册标记，不加入虚构的照片缩略图或新下载功能。
- [x] 在 `src/styles.css` 中实现 QQ 蓝色主面板、暖黄主操作、清楚的设置区与状态卡片；定义初始、进度、完成、警告/错误的可读状态色。
- [x] 保留键盘焦点样式、长文本截断和 `prefers-reduced-motion` 支持。
- [x] 确认 `src/popup.js` 无需改动，继续使用既有 DOM ID 和 class 更新界面。

**Review checklist:**

- [ ] 360px 弹窗宽度下无横向溢出，控件文字完整。
- [ ] 长相册名称被截断而不挤压主操作。
- [ ] 进度条与完成、警告/错误配色在新背景下清楚可辨。
- [ ] 焦点和减少动态效果样式仍然可用。
