---
title: "Vue 3 渲染机制解析"
date: "2026-02-02"
desc: "探讨 Vue 3 核心渲染 loop 机制与性能优化关键路径。"
cover: /images/covers/vue-rendering.svg
tags: ["Vue", "Frontend", "Performance"]
---

# Vue 3 渲染机制解析

Vue 3 的渲染系统是其高性能的核心。本文将简要介绍从 `template` 到 `vdom` 再到真实 DOM 的过程。

## 核心流程

1. **Compiler**: 将模板编译为渲染函数。
2. **Runtime**: 执行渲染函数，生成 Virtual DOM。
3. **Reactivity**: 响应式数据变化触发副作用函数，重新执行渲染。
4. **Patch**: 比较新旧 VDOM，计算最小差异并应用。

### 示例代码

```javascript
import { ref } from 'vue';

export default {
  setup() {
    const count = ref(0);
    return { count };
  }
}
```

> 提示：Vue 3 的 `Proxy` 机制比 Vue 2 的 `Object.defineProperty` 性能更好，且支持更多数据类型。
