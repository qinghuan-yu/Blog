---
title: "Pianalysis V5 解析"
date: "2026-06-10"
updated: "2026-11-08"
desc: "从和声配位、三通道节奏到密度条件与受约束生成"
tags: ["项目"]
---

# Pianalysis V5 解析：密度条件下的钢琴伴奏生成

## 1. 任务与整体结构

Pianalysis V5 根据旋律 MIDI、和声时间段和疏密档位生成钢琴伴奏，最后将伴奏与原旋律合并。它把编配拆成两个相互配合的任务：配位模型决定弹哪些音，节奏模型决定这些音何时开始、持续多久、用多大力度。

这里的“配位”是指把和弦音安排到具体音区。例如 C 大三和弦给出了 C、E、G 三个音级，配位还要决定它们各用哪个八度，以及低音放在哪里。

V5 沿用冻结的 V3 配位模型，更新的是上方声部的节奏生成。

```text
旋律 MIDI + 和声时间段 + 密度档位
                  ↓
       V3 配位              V5 节奏
   一个低音、三个上方音    起音、时值、相对力度
                  ↓
         按音级映射，换算全局 tick
                  ↓
         合并原旋律，导出 MIDI
```

两类模型的训练目标也有所区别：V3 学习规则构造的配位练习，V5 学习真实钢琴伴奏经过投影后的节奏。低音持续时间、整体音量和 MIDI 写出由程序处理。

![Pianalysis V5 的训练与生成流程：真实伴奏投影训练节奏模型，生成时结合冻结配位与调用者指定的密度](/images/notes/pianalysis/training-inference.svg)

本文按输入、数据表示、训练、生成和实验结果展开。[项目说明](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/README.md) · [V5 实现指南](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/V5_IMPLEMENTATION.md) · [迭代记录](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/ITERATION_HISTORY.md)

## 2. 输入与时间坐标

### 2.1 旋律和和声计划

生成入口接收三项主要输入。

| 输入 | 内容 |
| --- | --- |
| `melody.mid` | 要保留的原旋律，以及速度、拍号等 MIDI 信息 |
| `harmony-plan.json` | 每个和弦的起止位置、根音、低音、音级集合 |
| `density` | `sparse`、`medium` 或 `dense`，控制上方起音的疏密 |

和声计划中，一个 C 大三和弦片段可以写成下面的字段。这里约定 PPQ 为 480，片段占两个四分音符。

```json
{
  "symbol": "C:maj",
  "status": "chord",
  "root_pc": 0,
  "bass_pc": 0,
  "quality": "maj",
  "pitch_classes": [0, 4, 7],
  "start_tick": 0,
  "end_tick": 960
}
```

音级是 MIDI 音高模 12 的结果。C 的音级为 0，E 为 4，G 为 7。`root_pc` 与 `bass_pc` 分开记录，因此 C/G 可以保留 C 为根音、G 为低音的转位关系。

生成前会检查计划与旋律的 PPQ、全曲长度和时间原点；计划带有旋律哈希时，也会核对源文件。当前节奏表示支持大、小三和弦，每个和声段最多四个四分音符。

### 2.2 从全局 tick 到局部格点

PPQ 表示一个四分音符包含多少个 MIDI tick。V5 将一个四分音符分成四格，即十六分音符网格。

设 PPQ 为 `Q`，当前和声段起止位置为 `a`、`b`：

```text
每格长度 Δ = Q / 4
片段格数 L = (b - a) / Δ = 4(b - a) / Q
第 s 格的起点 = a + sΔ，s = 0, 1, ..., L - 1
```

`L` 必须是 1 到 16 的整数。上例 `Q=480`，每格 120 ticks，两拍共有 8 格。若速度为 120 BPM，一格对应 0.125 秒；速度改变时，格点在 MIDI 中的位置保持不变，秒数由速度图换算。

这套坐标让节奏与拍长对应。生成的局部位置最终加回和声段起点，恢复到整首旋律的时间线上。

## 3. 训练数据怎样形成

### 3.1 按曲目划分

V5 的节奏数据来自 POP909 命名轨：`MELODY` 提供旋律，`PIANO` 提供伴奏。和弦与拍点文件用于核对片段边界和音级。先固定曲目划分，再选择满足三和弦、低音、拍点和音区条件的片段。

| 用途 | 曲目 | 片段数 |
| --- | --- | ---: |
| 训练 | 001、002、005–010 | 135 |
| 验证与选择检查点 | 003、011 | 35 |
| 测试 | 004、012 | 25 |
| 合计 | 12 首 POP909 | 195 |

同一首歌的片段放在同一个划分中。训练曲目有 8 首，重复段落仍可能具有相近节奏。外部旋律 test1 的 8 个和声段用于生成和试听。

![V5 按曲目划分数据：8首训练、2首验证、2首测试，test1单独用于外部试听](/images/notes/pianalysis/piece-level-split.svg)

片段审阅记录保留原 MIDI、和弦与拍点文件的哈希，以及音级、低音和起音量化证据。数据的 `assistant_symbolic_reviewed` 状态表示已进行符号核对，试听结果另行记录。

### 3.2 把真实伴奏投影到三条通道

V5 的三条上方通道按和弦根、三、五音排列。对于 C 大三和弦，它们分别对应 C、E、G；对 C 小三和弦则为 C、E♭、G。通道保留音级职责，具体音高由配位模型给出。

每个和声段按以下步骤处理原 PIANO 轨：

1. 找出与该段交叠的伴奏音符，将最低的指定低音音高分离。
2. 记录本段内部的新起音，把属于三和弦的上方音归入对应通道。
3. 将起音与结束位置量化到格点，结束位置裁到和声段末尾。
4. 合并同格、同音级的八度重复，保留较长时值和较高力度档。
5. 同一通道再次起音时，将前一个参考音的结束位置限制在新起音之前或该位置。

跨段延续的上方音保留在审阅记录中，本段目标只计新的起音。按音符与和声段的交叠计数，本轮有 1691 项，分离低音 234 项，排除跨界上方延音 55 项，合并八度重复 19 项，最终得到 1383 个上方起音。其中 194 个参考音的时值因同通道重触发被截短。

因此，模型学习的是三通道节奏表示。原伴奏的八度叠置、踏板和跨和弦延音会在投影中丢失。

### 3.3 相对力度

力度先除以当前和声段交叠伴奏音符的平均力度，再映射到最接近的一档：

```text
力度档位 k       0     1     2     3
相对增益 g[k]   0.75  0.90  1.05  1.20
```

这样保留的是片段内部的轻重关系。生成时，再结合当前旋律力度计算伴奏的实际 MIDI velocity。

## 4. 配位模型负责音高

V5 使用冻结的 V3 模型预测四个 MIDI 音高：一个低音和三个上方和弦音。输入包括当前和弦的根音、低音、音级集合，当前旋律的音区与音级概况，以及上一组配位。

```text
和弦 + 旋律概况 + 上一组配位
                 ↓
       [bass, upper_1, upper_2, upper_3]
```

V3 的训练目标由规则教师构造。规则在三和弦候选配位中，优先选择声部移动较小、音区合适的排列，并约束上方三音跨度不超过一个八度、最高伴奏音与旋律至少间隔三个半音。模型为 2 层、4 头、128 维的小型 GPT-2。

推理时按低音到上方音的顺序贪心生成四个音高，再检查和弦完整性、低音、声部顺序和音区。节奏模型随后按音级匹配这些音高。例如配位 `[36, 48, 52, 55]` 中，36 作为低音，根、三、五通道分别映射到 48、52、55。

上一组配位让相邻和弦可以参考已有声部位置；上一段起音模式则交给节奏模型处理。两种历史在各自的模型中传递。[配位实现](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/scripts/local_voicing.py)

## 5. V5 的节奏表示

### 5.1 用三位 mask 表示同时起音

每个格点有三条通道，每条通道取“起音”或“不起音”。三个二值量组成一个整数：

```text
mask = 根音起音 × 1 + 三音起音 × 2 + 五音起音 × 4
```

所以 mask 的范围是 0–7。`0` 表示没有新起音，`5 = 1 + 4` 表示根音和五音同时起音，`7` 表示三条通道一起起音。`0` 格点上仍可能有前面的音继续延长。

在程序里，每格保存一个 frame：

```python
{
    "mask": 5,
    "durations": [4, None, 2],
    "velocities": [1, None, 1]
}
```

这个 frame 表示根音持续 4 格、五音持续 2 格，两者力度档均为 1；三音没有起音。

### 5.2 密度条件

密度按上方新起音数除以四分音符数计算。设一个片段有 `L` 格，`popcount` 表示 mask 中为 1 的位数：

```text
上方起音数 N = Σ popcount(mask[s])
每四分音符起音数 ρ = N / (L / 4) = 4N / L
```

同格的三个音计为三次起音，持续低音不计入这个密度。

| 档位 | 训练标签条件 | 训练片段数 |
| --- | --- | ---: |
| `sparse` | ρ ≤ 2 | 35 |
| `medium` | 2 < ρ ≤ 3 | 69 |
| `dense` | ρ > 3 | 31 |

训练时用参考伴奏计算档位；生成时由调用者选择档位，并写入提示。解码器允许每格选择全部八种 mask，疏密差异通过模型的条件输入产生。

### 5.3 提示中有哪些信息

V5 节奏提示的结构如下：

```text
[BOS] [LENGTH_L] [MAJOR 或 MINOR]
[PREVIOUS] 上一段的起音 mask
[MELODY] 当前段逐格旋律特征
[DENSITY] [SEP]
```

上一段只传入最多 16 个起音 mask。当前段的旋律每格用两个 token 表示：

- 该格内的旋律新起音数，超过 3 按 3 记录。
- 该格内最高活动旋律音相对和弦根音的音级；没有活动音时使用休止值。

例如 C 和弦上的 G，其相对音级为 7。使用相对音级后，相同的和弦内旋律关系可以跨调共享表示。具体根音与低音由前面的配位模型处理。

### 5.4 96 个 token 的词表

| 字段 | 值域 | token ID |
| --- | --- | --- |
| 控制与段落标记 | PAD、BOS、SEP、EOS、PREVIOUS、MELODY、MAJOR、MINOR | 0–7 |
| 生成阶段 | ONSETS、DETAILS | 8、9 |
| 片段格数 | 1–16 | 16–31 |
| 格点位置 | 0–15 | 32–47 |
| 起音 mask | 0–7 | 48–55 |
| 持续格数 | 1–16 | 56–71 |
| 力度档位 | 0–3 | 72–75 |
| 旋律起音数 | 0–3 | 76–79 |
| 旋律相对音级、休止 | 0–11、12 | 80–92 |
| 疏密档位 | sparse、medium、dense | 93–95 |

ID 10–15 留空，词表大小按最大 ID 加一得到 96。编码中的时值以格数计，实际长度还要乘以每格对应的 tick。

## 6. 先生成起音，再生成时值

### 6.1 为什么调整预测顺序

V4 在每个格点依次生成起音、时值和力度，然后进入下一格。预测一个音的时值时，后面何时再次起音尚未确定。

V5 将目标拆成两个阶段：先生成整段所有格点的起音 mask，再按格点和通道顺序生成每个已起音事件的时值与力度。

```text
[ONSETS]
  STEP_0 MASK(A_0)
  STEP_1 MASK(A_1)
  ...
  STEP_(L-1) MASK(A_(L-1))
[DETAILS]
  有起音的格点 → 各活动通道的 DURATION、VELOCITY
[EOS]
```

这里 `A_s` 表示第 `s` 格的起音 mask，`MASK(A_s)` 是它对应的 token。两个阶段使用同一个因果 Transformer；进入 DETAILS 后，模型已经看过整段起音。

记输入提示为 `C`，全部起音为 `A`，时值为 `D`，力度为 `V`，则生成可以写成：

```text
P(A, D, V | C) = P(A | C) · P(D, V | A, C)
```

两个因子内部继续按 token 顺序自回归预测。

### 6.2 时值的合法范围

设通道 `k` 在第 `s` 格起音，下一次同通道起音的位置为 `n`；如果后面没有起音，就令 `n=L`。持续格数的合法范围为：

```text
d_max(s, k) = n - s
1 ≤ duration(s, k) ≤ d_max(s, k)
```

解码只在这些合法时值的 logits 中取最大值。同一个音因此可以持续到下一次起音，也可以提前结束形成空隙。

这个上限由已生成的起音表确定。V5 输出交给渲染器后，同通道的长音不会再因后续重触发而被截短。

### 6.3 一个两拍的编码例子

构造前面的两拍 C 大三和弦，8 格的起音 mask 为：

```text
格点    0  1  2  3  4  5  6  7
mask    5  0  2  0  1  0  0  0
```

第 0 格根音与五音同时起音，第 2 格三音起音，第 4 格根音再次起音。共有 4 个上方起音，密度为 `4 / 2 = 2`，训练档位为 sparse。

为四个事件指定如下细节：

| 起音格 | 通道 | 时值上限 | 选择时值 | 力度档 |
| ---: | --- | ---: | ---: | ---: |
| 0 | 根音 | 4 | 4 | 1 |
| 0 | 五音 | 8 | 2 | 1 |
| 2 | 三音 | 6 | 2 | 2 |
| 4 | 根音 | 4 | 3 | 1 |

第一个根音的上限为 4，因为第 4 格会再次起音。五音后面没有重触发，上限可以到片段末尾，但这个例子只让它持续 2 格。

![V5 两阶段编码例子：8格起音先确定，再根据下一次同通道起音限制时值](/images/notes/pianalysis/note-event-encoding.svg)

使用词表中的实际 ID，提示之后的目标序列为：

```text
8,
32, 53, 33, 48, 34, 50, 35, 48,
36, 49, 37, 48, 38, 48, 39, 48,
9,
32, 59, 73, 57, 73,
34, 57, 74,
36, 58, 73,
3
```

其中 `8`、`9` 是阶段标记，`32–39` 是格点；`53 = 48 + 5` 表示 mask 5，`59 = 56 + 4 - 1` 表示持续 4 格。DETAILS 阶段只写有起音的格点，通道按根、三、五的顺序读取。[V5 编码与解码](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/scripts/rhythm_v5.py)

## 7. 模型与训练

### 7.1 模型规模

节奏模型使用 GPT-2 风格的因果 Transformer，配置如下。

```text
vocab_size = 96
n_positions = 256
n_layer = 2
n_head = 4
n_embd = 96
dropout = 0.2
parameters = 257664
```

本轮最长实际序列为 128 tokens。和声段长度有上限，音高任务又交给独立的配位模型，因此节奏序列比较短。

### 7.2 哪些位置参与损失

训练仍然是 next-token prediction。提示、padding、给定格点和阶段标记的 label 设为 `-100`；起音 mask、时值、力度以及 EOS 参与交叉熵。

```text
输入 token： ... SEP ONSETS STEP_0 MASK_5 STEP_1 MASK_0 ...
对应 label： ... -100  -100   -100 MASK_5   -100 MASK_0 ...
```

GPT-2 在内部将预测与标签错开一位：读到 `STEP_0` 后预测 `MASK_5`，这个预测计入损失。提示、格点和阶段标记仍作为上下文被读取，只是不要求模型学习输出它们。padding 另由 `attention_mask` 屏蔽。

![V5 的损失掩码：提示、格点和阶段标记提供上下文，起音mask、时值、力度与EOS参与预测损失](/images/notes/pianalysis/token-loss-alignment.svg)

记参与监督的位置集合为 `S`，损失为：

```text
L = -(1 / |S|) Σ log Pθ(x_i | x_0, ..., x_(i-1)),  i ∈ S
```

训练使用参考 token 历史；生成时使用自身预测的起音与细节。相邻段的历史也有同样区别：训练传入上一段参考 mask，生成传入上一段生成 mask。

### 7.3 优化与检查点

| 项目 | 设置或结果 |
| --- | --- |
| 优化器 | AdamW，学习率 `4e-4`，weight decay `0.02` |
| batch size / seed | 16 / 42 |
| 学习率调度 | 20 步 warmup 与余弦调度 |
| 梯度范数上限 | 1.0 |
| 最大轮数 | 250 |
| 验证与早停 | 每 10 轮验证，连续 8 次不改善则停止 |
| 最佳检查点 | 第 20 轮 |
| 实际停止 | 第 100 轮 |
| 最佳验证 NLL | 1.301675 |
| 本次训练计时 | 约 10.84 秒 |

验证 NLL 使用参考历史与参考密度档位来选检查点。后面的自由生成对照统一指定 medium，再分别观察 sparse、dense 的控制效果。[训练实现](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/scripts/train_rhythm_v5.py)

## 8. 从预测到 MIDI

### 8.1 按字段贪心解码

V5 生成器根据当前所需字段，从合法 token 范围内选择最大 logit：

```text
起音 mask：8 个候选
持续时间：1 到 d_max 个格点
相对力度：4 个候选
```

阶段标记和格点由程序插入。生成器完成 `L` 个 mask，再遍历其中的活动通道；已知的格数与通道数决定循环何时结束。EOS 用于训练序列，独立生成过程按这些循环完成当前段。

### 8.2 跨段传递

每完成一个和弦，程序将当前配位和起音表保存为下一段的历史。遇到未标注区间或不连续边界，配位回到初始值，节奏历史清空；这些区间只保留原旋律。

历史起音表帮助模型参考前一段的节奏形状。每个音的时值仍在当前和声段内结束，跨和弦延音属于后续需要扩展的表示。

### 8.3 通道映射与实际力度

起音表给出音级职责，V3 配位给出实际 MIDI 音高。前面例子的根、三、五通道映射到 48、52、55 后，产生四个上方音符；低音 36 从片段开始持续到结束。

```text
start_tick = a + round(step × Q / 4)
end_tick   = a + round((step + duration) × Q / 4)
```

上方声部的基础力度由当前旋律力度中位数 `m` 决定：

```text
base_velocity = clamp(round(0.45m), 16, 50)
velocity = clamp(round(base_velocity × g[k]), 1, 64)
```

低音使用 `clamp(round(0.52m), 20, 58)`。这里 `clamp(x, lo, hi)` 表示把数值限制在上下界之间。模型选择相对轻重档位，规则决定整体平衡。

![两拍示例的音高与节奏合成：根三五通道映射到48、52、55，低音36持续两拍，再合并原旋律](/images/notes/pianalysis/harmony-rhythm.svg)

输出 MIDI 合并原旋律与生成伴奏，保留速度、拍号、调号和 PPQ。生成目录还保存音频预览，以及包含 frames、配位、最终音符和模型哈希的 `result.json`。[生成入口](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/scripts/generate_rhythm_v5.py)

## 9. 实验结果

### 9.1 比较对象

本轮同时比较数据扩充和 V5 表示。各方法共用冻结的 V3 配位与相同和声计划。

| 方法 | 节奏训练片段 | 节奏生成方式 |
| --- | ---: | --- |
| 原 V4 | 39 | 起音、时值、力度逐格交错生成 |
| 扩充 V4 | 135 | 保持 V4 表示与训练配置 |
| V5 | 135 | 全段起音优先，加入密度条件 |
| 固定分解 | 0 | 按同一配位生成八分音符规则节奏 |

V5 同时改变了顺序与密度输入，本轮没有单独拆开这两项做消融。

### 9.2 起音与时值

起音以“格点 × 音级通道”为一个事件，与投影参考匹配。规则低音不参与这个指标。

```text
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2TP / (2TP + FP + FN)
```

| 起音 F1 | 原 V4 | 扩充 V4 | V5 medium | 固定分解 |
| --- | ---: | ---: | ---: | ---: |
| 验证 | 0.6497 | 0.6600 | 0.5904 | 0.4585 |
| 测试 | 0.5266 | 0.5329 | 0.5234 | 0.3123 |

分开看两首测试曲目，004 的 F1 从原 V4 的 0.7154 变为 V5 的 0.6792；012 从 0.4186 变为 0.4465。两首聚合后的起音成绩接近，曲目之间的变化方向不同。

时值误差先在匹配起音上计算绝对差，再以四分音符为单位取均值。由于不同方法命中的事件不同，再取三者共同匹配到的参考起音进行比较：

| 共同起音的时值 MAE | 共同起音数 | 原 V4 | 扩充 V4 | V5 medium |
| --- | ---: | ---: | ---: | ---: |
| 验证 | 118 | 0.1949 | 0.1462 | 0.1631 |
| 测试 | 66 | 0.2045 | 0.1705 | 0.1629 |

在这 66 个共同测试事件上，扩充数据和 V5 都降低了时值误差。测试中同通道重触发引起的渲染截短次数，原 V4 为 19，扩充 V4 为 1，V5 三档均为 0。

### 9.3 密度控制

test1 上方每四分音符的起音数如下。

| 原 V4 | 扩充 V4 | V5 sparse | V5 medium | V5 dense | 固定分解 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 3.79 | 2.97 | 1.55 | 2.45 | 3.31 | 2.00 |

12 首 POP909 加 test1 共 13 个案例，平均密度都满足 sparse < medium < dense。按片段看，203 段全部不递减，其中 147 段严格递增。

档位给出疏密倾向，实际数值随片段变化。例如 007 的 dense 档平均为 2.65，仍低于训练标签中 dense 的分界 3。

### 9.4 旋律响应与试听

将验证提示中的旋律格点顺序反转后，V5 的 NLL 从 1.301675 变为 1.301782，变化很小。当前模型对旋律时序的响应仍弱。尾奏的七个完整和声段中，有六段使用了同一起音图案；对等长历史起音模式的扰动也不敏感。

test1 的试听更偏好原 V4 的自然度，因此扩充 V4 和 V5 继续作为实验候选。V5 提供了可用的密度控制，并改善了本批部分时值指标；原 V4 保持为已认可的试听基准。[试听比较记录](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/examples/harmony/rhythm_v5_audition.json)

后续以 V4 为参考，分别删音、调整部分时值和力度，三项局部干预都获得了自然的试听反馈，回退的具体原因还未定位。[局部干预试听记录](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/examples/harmony/naturalness_audition.json)

## 10. 运行与复现

### 10.1 使用现有权重

项目使用 Python 3.11，在项目根目录安装依赖：

```powershell
python -m pip install -r requirements.txt -r requirements-harmony.txt
```

准备好源 MIDI、和声计划和模型权重后，可以运行：

```powershell
python scripts/generate_rhythm_v5.py --density medium --out-dir data/rhythm_v5_my_preview
```

该命令默认使用 test1 及其已核对的和声计划，加载 `model_output/local_rhythm_v5/final_model` 和 `model_output/local_voicing_v3/final_model`。生成器要求输出目录尚不存在。

输出包括：

```text
data/rhythm_v5_my_preview/output.mid
data/rhythm_v5_my_preview/output.wav
data/rhythm_v5_my_preview/result.json
```

`output.wav` 使用加法合成音色，供快速试听。采样钢琴需要先准备 FluidSynth 和音色库，再渲染刚生成的 MIDI：

```powershell
python scripts/setup_piano_renderer.py
python scripts/render_piano_preview.py --input-midi data/rhythm_v5_my_preview/output.mid --out-dir data/rhythm_v5_my_preview_piano
```

采样版本写入 `data/rhythm_v5_my_preview_piano/output_piano.wav`，目录中也有试听页。渲染保持 MIDI 的音符、节奏和力度；伴奏升八度由 `preview_accompaniment_register.py` 单独处理。[钢琴渲染实现](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/scripts/render_piano_preview.py)

更换旋律时，同时指定对应计划。下面的路径替换为自己的文件：

```powershell
python scripts/generate_rhythm_v5.py --melody-midi my_melody.mid --harmony-plan my_harmony_plan.json --density sparse --out-dir data/my_melody_v5_sparse
```

`--model` 和 `--voicing-model` 可以指定两类模型目录。疏密比较时，保持旋律、和声和权重一致，分别使用三个 density 值与不同输出目录。

### 10.2 重建数据与训练

源数据准备齐全后，按已有片段配置重建标注，再训练 V5：

```powershell
python scripts/build_trusted_harmony.py --config examples/harmony/trusted_subset_v5.json --out-dir data/trusted_harmony_v5_new
python scripts/train_rhythm_v5.py --protocol v5 --annotations data/trusted_harmony_v5_new/annotations.json --output-dir model_output/local_rhythm_v5_new
python scripts/generate_rhythm_v5.py --model model_output/local_rhythm_v5_new/final_model --density medium --out-dir data/rhythm_v5_new_preview
```

训练参数来自 `examples/harmony/rhythm_v5_experiment.json` 和训练脚本。`final_model` 保存最佳验证检查点；生成命令明确指向刚训练的目录，配位继续使用冻结 V3。

若要复现“只扩充数据”的对照，将训练命令的 `--protocol` 改为 `v4`，并使用另一输出目录。公开仓库提供代码、配置和结果记录，源 MIDI、训练数据及权重保存在本地。[实验配置](https://github.com/qinghuan-yu/Pianalysis/blob/87a64997a6db7108e9f6903fd258803a0e340b8c/examples/harmony/rhythm_v5_experiment.json)

## 11. 后续问题

V5 把起音安排、时值边界和疏密条件联系起来，配位与节奏也可以分别检查。接下来主要有三项工作。

1. **旋律条件响应。** 在相同和声下替换不同旋律，检查伴奏是否作出可听见、可解释的节奏变化。
2. **声部连续性。** 扩展跨和弦延音与独立低音节奏，减少三通道投影丢失的信息。
3. **自然度评估。** 在更多独立曲目上分别比较疏密、时值和力度，把客观变化与试听偏好对应起来。

现有结果中，时值误差的改善与 test1 的自然度偏好没有同步。下一步需要定位这种差异来自哪些音乐事件，再决定如何调整表示和训练目标。

