---
title: "Pianalysis 技术解析：从旋律 MIDI 到风格化钢琴伴奏生成"
date: "2026-06-10"
desc: "一次从数据清洗、旋律抽取、token 设计、条件训练到 MIDI 生成闭环的完整工程复盘"
tags: ["深度学习","符号音乐生成","Transformer","MIDI","项目"]
---

# Pianalysis 技术解析：从旋律 MIDI 到风格化钢琴伴奏生成

## 0. 写在前面

Pianalysis 的目标可以用一句话概括：

> 输入一段旋律 MIDI，让模型补全钢琴伴奏织体，最后输出一份保留原旋律、带有风格化伴奏的 MIDI。

这不是音频生成任务，而是符号音乐生成任务。模型不直接预测波形，而是在 MIDI 事件被编码后的 token 序列上做条件生成。

当前项目已经从最初的“无条件 GPT-2 音乐 token 续写”推进到了一个真正闭环的工程版本：

```text
MIDI 数据集
-> 增强 Skyline + 动态规划抽取旋律
-> 拆分 melody / accompaniment
-> 编码为条件 token 序列
-> 切成可训练窗口
-> GPT-2 只学习 accompaniment target
-> 输入 melody prompt 生成 accompaniment
-> 解码并导出 MIDI
```

这篇文章会完整拆解其中的技术原理、关键运算、工程选择、目前效果和后续改进方向。

---

## 1. 任务定义：不是“生成一首歌”，而是“条件编配”

### 1.1 目标输入与输出

理想产品形态是：

```text
input:  melody.mid
output: arranged.mid = original_melody + generated_accompaniment
```

这里有一个非常重要的设计选择：**模型不负责重写旋律，只负责生成伴奏**。

也就是说，训练目标不是：

```text
melody -> full arrangement
```

而是：

```text
melody -> accompaniment
```

推理时再把原始旋律和生成伴奏合并：

```text
final_midi = input_melody_midi + generated_accompaniment_midi
```

这样做的好处是：

- 输入旋律不会被模型改坏。
- 训练目标更清楚。
- 模型只需要学习“如何围绕旋律补织体”。
- 推理结果更可控，尤其适合用户上传旋律再自动编配的场景。

### 1.2 用 Causal LM 做条件生成

当前版本没有使用 encoder-decoder，而是使用 GPT-2 风格的 causal language model。

训练序列被拼成：

```text
[BOS] source_melody [SEP] target_accompaniment [EOS]
```

模型仍然做 next-token prediction，但 loss 只计算 `[SEP]` 后面的 accompaniment 部分。

这等价于让 GPT-2 在看到 melody prompt 后，学习继续写出 accompaniment target。

---

## 2. 数据源：为什么 MIDI 不能直接拿来训练

MIDI 文件虽然是结构化音乐数据，但它不是天然适合模型训练的监督数据。原始 MIDI 里通常只有：

- 多个 track / instrument
- note start
- note end
- pitch
- velocity
- tempo / time signature 等元事件

它不会告诉我们：

```text
哪一个音是旋律？
哪一些音是伴奏？
哪一些音只是装饰音？
哪个声部是主线？
```

对于钢琴独奏尤其麻烦。因为钢琴 MIDI 常常把右手旋律、右手分解和弦、左手低音、内声部全部混在一起。

如果直接把完整 MIDI 当 target，而 source 又来自粗糙旋律抽取，模型会学到很多脏关系：

```text
错误旋律 -> 错误伴奏
伴奏高音 -> 被误判为旋律
旋律八度重复 -> 被错误拆分
装饰音 -> 被当作主旋律
```

所以 Pianalysis 的第一件事不是训练模型，而是构造一个尽可能稳定的数据生产线。

---

## 3. 旋律抽取：从 Skyline 到增强 Skyline + 动态规划

### 3.1 原始 Skyline 的假设

Skyline 算法的基本假设是：

```text
同一时刻最高音 = 主旋律
```

它的优点是简单、快、容易实现。缺点也非常明显：钢琴编曲里最高音未必是旋律。

典型误判场景包括：

- 右手分解和弦高音超过旋律。
- 装饰音短暂冲到旋律上方。
- 八度铺陈中上下声部混合。
- 伴奏或反旋律跑到高音区。
- 复杂 Animenz 风格改编中，旋律和织体高度交织。

因此，原始 Skyline 只能作为 baseline，不能作为最终标注。

### 3.2 增强思路：旋律是一条路径，不是每一帧最高音

Pianalysis 当前实现了一个轻量但实用的方案：

```text
每个 onset 取 top-k 候选音
-> 给候选音打局部分
-> 用动态规划寻找最连贯的旋律路径
-> 后处理去掉孤立跳进和部分八度重复
```

核心观念是：

> 旋律不是某个瞬间最高的点，而是一条时间上连续、音高运动合理、节奏上有重心的线。

### 3.3 候选音分组

先把音符按 onset 时间量化分组：

```python
onset_tick = round(note.start * 1000 / quantum_ms)
```

当前默认：

```text
quantum_ms = 10
```

也就是以 10ms 为单位对起音时间做量化。

对于每个 onset group，按音高从高到低取前 `top_k` 个候选音：

```text
candidates(t) = top_k_notes_by_pitch(notes_at_onset_t)
```

当前默认：

```text
top_k = 5
```

这比只取最高音更稳，因为旋律可能是第二高、第三高，甚至被短暂装饰音盖住。

### 3.4 候选音局部分数

每个候选音会得到一个局部分数：

```text
local_score(note) =
  0.95 * pitch_height
+ 0.62 * duration_score
+ 0.22 * velocity_score
+ 0.48 * rank_score
+ metrical_weight
- density_penalty
- short_note_penalty
- low_pitch_penalty
```

各项含义如下：

#### pitch_height

```text
pitch_height = (pitch - 21) / (108 - 21)
```

钢琴音域通常近似为 MIDI 21 到 108。音高越高，越可能是旋律，但这个权重不能过大，否则会退化回 Skyline。

#### duration_score

```text
duration_score = min(duration / 0.75, 1.2)
```

旋律音通常比装饰音更长。极短音容易是经过音、琶音碎片或装饰。

#### velocity_score

```text
velocity_score = velocity / 127
```

力度大的音更容易被听成主线，但 MIDI 速度并不总可靠，所以权重较小。

#### rank_score

```text
rank_score = 1 / (rank_from_top + 1)
```

同一 onset 中越靠高音，rank score 越高。

#### density_penalty

```text
density_penalty = min((chord_size - 1) * 0.08, 0.45)
```

如果同一时刻有很多音，很可能是和弦或织体块。候选音仍可能是旋律，但要轻微降权。

#### short_note_penalty

当前实现对极短音有较大惩罚：

```text
duration < 0.055s -> -1.20
duration < 0.10s  -> -0.55
duration < 0.16s  -> -0.20
```

这主要用于抑制装饰音、碎音和快速琶音误判。

### 3.5 动态规划转移分数

有了每个 onset 的候选音，还需要选择一条全局最合理的路径。

设第 `t` 个 onset 的候选为：

```text
C_t = {c_t1, c_t2, ..., c_tn}
```

动态规划目标是最大化：

```text
sum local_score(c_t) + sum transition_score(c_{t-1}, c_t)
```

当前转移分数主要考虑：

```text
interval = abs(current.pitch - previous.pitch)
onset_gap = current.start - previous.start
rest_gap = current.start - previous.end
```

规则大致是：

- 小跳进加分。
- 大跳进扣分。
- 很短时间内大跳进重扣。
- 长休止轻微扣分。
- 与前一音重叠且音高不同，轻微扣分。

简化写法：

```text
transition_score =
  -0.055 * interval
  -0.45  if interval > 12
  -0.85  if interval > 19
  +0.18  if interval <= 2 and onset_gap <= 1.2
  +0.12  if interval <= 5 and onset_gap <= 1.2
  -0.50  if onset_gap < 0.08 and interval > 7
  -0.15  if rest_gap > 2.5
```

这让算法更偏好“像旋律线”的连续路径，而不是每一帧贪心选最高音。

### 3.6 DP 递推公式

令：

```text
dp[t][j] = 到第 t 个 onset，选择候选 j 时的最高总分
```

则：

```text
dp[t][j] =
  local_score(c_tj)
  + max_i(dp[t-1][i] + transition_score(c_{t-1,i}, c_tj))
```

同时记录 backpointer：

```text
prev[t][j] = argmax_i(...)
```

最后从最高分状态回溯，得到旋律 note id 集合。

这一步就是 `scripts/dp_melody_cleaning_v1.py` 的核心。

### 3.7 后处理

DP 路径之后还做了两个简单后处理：

1. 去掉短时值且前后都是大跳的孤立高音。
2. 对同 onset 的八度重复，默认保留高音，丢掉低八度。

这些规则并不完美，但能减少一部分“旋律条件过厚”的问题。

---

## 4. 数据清洗产物

运行：

```powershell
python scripts/dp_melody_cleaning_v1.py --midi-dir MIDI --out-dir data\dp_cleaned_v1 --write-midi
```

会生成：

```text
data/dp_cleaned_v1/dataset_dp_v1.json
data/dp_cleaned_v1/cleaning_report.json
data/dp_cleaned_v1/annotated_notes/*.json
data/dp_cleaned_v1/melody_midi/*_melody.mid
data/dp_cleaned_v1/accompaniment_midi/*_accompaniment.mid
data/dp_cleaned_v1/annotated_midi/*_annotated.mid
data/dp_cleaned_v1/roundtrip_midi/*_roundtrip.mid
```

当前本地 40 首 MIDI 的清洗结果：

```text
Processed: 40
Failed: 0
Average melody ratio: 38.33%
Minimum melody ratio: 12.86%
Maximum melody ratio: 58.42%
Average sequence length: 20966 tokens
Maximum sequence length: 48859 tokens
```

需要优先人工复查的曲子：

```text
旋律比例偏高：
- call-of-silence: 50.10%
- in-the-pool: 53.67%
- uchiage-hanabi: 58.42%

旋律比例偏低：
- only-my-railgun: 12.86%
```

这个结果说明：增强 Skyline + DP 可以批量生产弱标注，但仍然不能替代人工听检。

---

## 5. MIDI 到 token：可逆闭环设计

### 5.1 为什么必须做闭环

早期版本最大的问题之一是：

```text
训练能跑，但 token 到底能不能还原成 MIDI 不确定。
```

这在符号音乐生成里很危险。因为 loss 下降不代表生成结果可播放，更不代表节奏、音符开关、持续时间合法。

因此当前项目先做了一个闭环验证：

```text
MIDI -> note JSON -> token -> note JSON -> MIDI
```

对应脚本：

```text
scripts/closed_loop_v1.py
```

### 5.2 当前 token 协议

当前使用紧凑数字事件流：

```text
PAD = 0
BOS = 1
SEP = 2
EOS = 3
TIME = 4
NOTE_ON_MELODY = 10
NOTE_OFF_MELODY = 11
NOTE_ON_ACCOMP = 20
NOTE_OFF_ACCOMP = 21
```

NOTE_ON 事件携带：

```text
[NOTE_ON_*, pitch, velocity]
```

NOTE_OFF 事件携带：

```text
[NOTE_OFF_*, pitch]
```

TIME 事件携带：

```text
[TIME, delta_tick]
```

其中：

```text
delta_tick * quantum_ms = 时间推进毫秒数
```

当前默认：

```text
quantum_ms = 10
```

### 5.3 编码过程

对每个 note：

```text
start_tick = round(start_seconds * 1000 / quantum_ms)
end_tick = max(start_tick + 1, round(end_seconds * 1000 / quantum_ms))
```

然后生成两个事件：

```text
note_on  at start_tick
note_off at end_tick
```

所有事件按：

```text
(tick, note_off_before_note_on, pitch)
```

排序。这样同一 tick 上先关音再开音，减少同音重叠混乱。

再转成 delta-time token：

```text
delta = event.tick - current_tick
if delta > 0:
    emit [TIME, delta]
emit event token
current_tick = event.tick
```

### 5.4 训练序列

清洗后，每个样本被编码为：

```text
[BOS] source_melody [SEP] target_accompaniment [EOS]
```

这里：

```text
source_melody = 只包含 role == melody 的事件
target_accompaniment = 只包含 role == accompaniment 的事件
```

这就是当前项目从“无条件音乐生成”变成“旋律条件伴奏生成”的关键。

---

## 6. 为什么还要切窗口

整曲 token 太长：

```text
平均约 20966 tokens
最长约 48859 tokens
```

而当前 GPT-2 配置：

```text
max_length = 1024
```

如果直接截断整曲，会导致：

- 大量 target 被截掉。
- 模型只看到曲子开头。
- 训练样本数量少。
- 长序列显存成本高。

所以必须切成短窗口。

### 6.1 窗口构建

脚本：

```text
scripts/build_training_windows_v1.py
```

输入：

```text
data/dp_cleaned_v1/annotated_notes/*.json
```

输出：

```text
data/training_windows_v1/dataset_windows_v1.json
```

默认窗口：

```text
window_seconds = 8.0
max_length = 1024
```

如果某个 8 秒窗口仍超过 1024 tokens，脚本会二分窗口继续切，直到满足长度，或者低于最小时长后丢弃。

### 6.2 过滤规则

窗口必须同时有：

```text
melody source
accompaniment target
```

否则拒绝。

拒绝原因包括：

```text
empty
missing_source_or_target
too_long
```

### 6.3 当前窗口化结果

本地结果：

```text
Processed pieces: 40
Accepted windows: 1530
Rejected windows: 8
Average window length: 573 tokens
Minimum window length: 17 tokens
Maximum window length: 1023 tokens
```

这意味着现在的数据已经真正适配 `max_length=1024` 的 GPT-2 训练。

---

## 7. 模型训练：GPT-2 条件伴奏生成

### 7.1 模型结构

当前模型是一个轻量 GPT-2 causal LM：

```text
vocab_size = 801
n_positions = 1024
n_embd = 512
n_layer = 6
n_head = 8
dropout = 0.1
params ≈ 19.85M
```

使用 GPT-2 的原因很现实：

- Hugging Face 生态成熟。
- 自回归 token 生成容易实现。
- 不需要立刻切到 encoder-decoder。
- 对第一版工程闭环足够。

长期看，`melody -> accompaniment` 更适合 encoder-decoder；但在数据协议还在迭代时，GPT-2 是更低成本的验证路线。

### 7.2 输入与标签

假设样本为：

```text
x = [BOS] + source + [SEP] + target + [EOS]
```

其中：

```text
target_start_index = len(source) + 2
```

因为 `[BOS]` 占 1 个位置，`[SEP]` 占 1 个位置。

训练时：

```python
labels = input_ids.copy()
labels[:target_start_index] = -100
labels[padding_positions] = -100
```

这点非常关键。旧版本中：

```python
labels = input_ids.clone()
```

会让模型连 source melody 和 PAD 也一起预测，导致训练目标污染。

现在的目标是：

```text
看到 melody prompt 后，只学习 accompaniment target。
```

### 7.3 Causal LM loss 运算

GPT-2 的 Causal LM loss 本质是：

```text
L = - sum_t log P(x_t | x_<t)
```

但被 mask 的位置不参与 loss。

实际有效 loss 是：

```text
L = - 1/N * sum_{t in target_positions} log P(x_t | x_<t)
```

其中：

```text
target_positions = {t | labels[t] != -100}
```

也就是只在伴奏 token 上优化。

### 7.4 按曲目切分训练/验证

窗口数据来自同一首曲子。如果随机按窗口切分，容易出现：

```text
同一首歌的一些窗口在 train
同一首歌的另一些窗口在 eval
```

这样 eval loss 会虚高可信度，因为模型见过同曲风格和局部模式。

当前训练脚本按 `source_piece_id` 切分：

```text
Train: 36 pieces, 1306 windows
Eval: 4 pieces, 224 windows
```

这比随机窗口切分更接近真实泛化评估。

### 7.5 训练结果

在 RTX 4070 Super 上，第一版 4 epoch 训练结果：

```text
steps: 656
runtime: 64s
train_loss: 2.4991
eval_loss: 2.2972
train_samples_per_second: 81.39
train_steps_per_second: 10.22
```

loss 走势：

```text
初始 loss ≈ 5.02
epoch 1.52 eval_loss ≈ 2.4766
epoch 3.05 eval_loss ≈ 2.2972
```

说明模型确实学到了伴奏 token 分布，但 4 epoch 只是 baseline。

---

## 8. 推理：从 melody prompt 生成 accompaniment

### 8.1 Prompt 构造

生成时输入：

```text
prompt = [BOS] + source_melody + [SEP]
```

模型从 `[SEP]` 后开始续写：

```text
generated = model.generate(prompt)
```

然后取：

```text
target_tokens = generated[len(prompt):]
```

遇到 `EOS` 则截断。

### 8.2 解码为 MIDI

解码时分别处理：

```text
source_melody -> melody notes
target_tokens -> accompaniment notes
```

最后：

```text
output_midi = melody_notes + accompaniment_notes
```

这就是 `generate_from_scratch.py` 当前做的事。虽然文件名还叫 `from_scratch`，但语义已经改成条件生成。

### 8.3 当前生成质量

第一版生成结果已经能被 MuseScore 正常打开，说明：

- prompt 正常。
- 模型能输出 token。
- token 能解码为 MIDI。
- melody + accompaniment 可以合并。

但音乐质量还处于 baseline 阶段：

- 伴奏偏短，可能过早生成 EOS。
- 织体不稳定，像碎片而不是完整钢琴伴奏。
- 低音支撑不足。
- 不规则节奏较多。
- 和声功能还不明确。

这符合预期。因为当前版本只用了：

```text
40 首弱标注 MIDI
1530 个短窗口
4 epoch
无小节/拍位/和声 token
```

它证明了系统活了，但还没有证明系统好听。

---

## 9. 工程问题修复对照

### 9.1 关键数据和模型产物缺失

旧问题：

```text
README 写 data/、tokenizer/、model_output/，但仓库没有对应可运行数据。
```

当前修复：

```text
data/training_windows_v1/dataset_windows_v1.json
```

已经由本地 MIDI 构建得到。模型产物则由训练脚本生成：

```text
model_output/accompaniment_gpt2/final_model
```

### 9.2 条件生成未实现

旧问题：

```text
训练只读 training_sequence
生成只从 BOS 开始
```

当前修复：

```text
[BOS] source_melody [SEP] target_accompaniment [EOS]
```

训练只对 target 算 loss，生成从 melody prompt 开始。

### 9.3 padding loss 污染

旧问题：

```python
labels = input_ids.clone()
```

当前修复：

```python
labels[:target_start_index] = -100
labels[padding_positions] = -100
```

### 9.4 MIDI 编解码闭环

旧问题：

```text
生成 token JSON 后无法判断音乐是否合法。
```

当前修复：

```text
MIDI -> note JSON -> token -> note JSON -> MIDI
```

并且训练前已经批量验证。

### 9.5 配置和代码不一致

旧问题：

```text
README、config、代码参数漂移。
```

当前修复：

- README 改成当前真实流程。
- config.json 同步到当前训练数据。
- requirements.txt 改成 pinned 版本。
- train_v2.py 支持 CLI。

### 9.6 工程化缺失

当前新增：

- 数据清洗脚本
- 闭环验证脚本
- 窗口化脚本
- 训练元数据保存
- 按曲目切分
- 随机种子
- early stopping
- TensorBoard 日志

---

## 10. 仍然存在的问题

### 10.1 弱标注不是 ground truth

增强 Skyline + DP 比原始 Skyline 强，但仍然是启发式算法。

它会在这些场景出错：

- 复杂右手织体。
- 旋律在内声部。
- 高音装饰过多。
- 多主旋律或反旋律。
- 八度旋律需要保留上下双音时。

所以后续需要 `vue-piano` 作为人工修正工具。

### 10.2 token 表示仍然粗糙

当前 token 是紧凑数字流，有工程效率，但音乐语义不够清晰。

例如：

```text
4, 20
```

要依赖上下文才知道 `4` 是 TIME，`20` 是 delta，而另一个位置的 `20` 可能是 NOTE_ON_ACCOMP。

长期更好的设计是 compound vocabulary：

```text
BAR
POS_0
PITCH_60
DUR_480
VEL_80
ROLE_ACCOMP
```

或者 REMI / Compound Word 风格 token。

### 10.3 缺少小节、拍位与和声条件

当前模型只看到时间差、音高和力度，不知道：

- 小节边界
- 拍位强弱
- 调性
- 和弦
- 风格标签
- 织体密度

所以生成结果容易节奏漂移、和声不稳。

### 10.4 数据量仍然很小

40 首 MIDI、1530 个窗口只能跑 baseline。

真正想要稳定生成，需要：

- 更多曲目。
- 更干净的人工标注。
- 更一致的风格来源。
- 更严格的数据质量报告。

---

## 11. 下一阶段路线

### 11.1 训练侧

短期建议：

```text
epochs: 20
batch_size: 8 or 16
监控 eval_loss
保存多组 generation samples
```

如果 20 epoch 后 eval loss 继续下降，可以继续训练；如果 train loss 降而 eval loss 升，则说明过拟合。

### 11.2 生成侧

当前伴奏容易过早结束。可以尝试：

```text
max_new_tokens = 900
temperature = 0.75
top_k = 30
top_p = 0.90
```

并加入生成后过滤：

- 如果伴奏 note 数过少，重采样。
- 如果 NOTE_ON/OFF 结构严重失衡，重采样。
- 如果总时长明显短于旋律，重采样或补尾。

### 11.3 数据侧

最重要的是人工修正：

```text
DP weak labels
-> vue-piano 可视化复查
-> approved annotated_notes
-> rebuild windows
-> retrain
```

优先修正：

```text
call-of-silence
in-the-pool
uchiage-hanabi
only-my-railgun
```

### 11.4 表示侧

下一版 token 可以引入：

- BAR
- POSITION
- DURATION
- VELOCITY_BUCKET
- CHORD
- STYLE
- DENSITY

目标是让模型从“事件流续写”升级为“音乐结构建模”。

---

## 12. 总结

Pianalysis 当前最大的进展不是生成质量已经多好，而是工程闭环真正成立了：

```text
MIDI 数据
-> 旋律/伴奏弱标注
-> 可逆 token
-> 可训练窗口
-> 条件 GPT-2
-> 伴奏生成
-> MIDI 导出
```

这是从“脚本能跑”到“任务定义正确”的关键一步。

当前生成质量还只是 baseline，音乐上仍然粗糙；但现在问题已经变得清楚：

```text
不是模型完全不会学，
而是数据标注、token 表示、音乐结构条件还不够好。
```

下一阶段的核心不应该是盲目堆模型，而是：

```text
人工修正标注
更强 token 表示
更长训练
更严格生成后验证
```

这也是符号音乐生成里最朴素但最重要的经验：

> 模型决定拟合能力，数据表达决定音乐上限。

