---
title: "Relic Data Hub 架构设计"
date: "2026-02-01"
desc: "关于主网站的 PixiJS 全局单例架构与 Vue 路由系统的深度整合记录。"
tags: ["前端"]
---

# Relic Data Hub 架构

本网站采用了“Arknights”的工业风设计（），但在实现上遇到了诸多挑战。

## 挑战：页面切换闪屏

最初，每个页面都有自己的 `Canvas`。这导致路由切换时：
1. 旧 Canvas 销毁
2. 新 Canvas 初始化
3. WebGL 上下文重建

**结果**：页面中间会出现1帧左右的白屏或闪烁。

## 解决方案：全局单例

将 PixiJS 实例移到了 `MainLayout` 层级：

| 组件 | 职责 |
| --- | --- |
| MainLayout | 持有全局 Pixi Application，负责 Canvas 挂载 |
| usePixiApp | 单例模式 Hook，管理粒子系统状态 |
| PixiBackground | 监听路由变化，触发粒子 `morph` 变形 |

> 这样无论路由如何切换，Canvas 始终存在，仅仅是粒子在屏幕上移动，彻底解决了闪烁问题。
