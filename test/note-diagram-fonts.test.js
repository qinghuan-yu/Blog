const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const posts = fs.readdirSync('source/_posts')
  .filter(name => name.endsWith('.md') && /!\[[^\]]*\]\(\/images\/notes\/[^)]+\.svg\)/.test(fs.readFileSync(path.join('source/_posts', name), 'utf8')))
  .map(name => name.slice(0, -3));

test('笔记解释图嵌入文章，能够使用页面已经加载的字体', () => {
  for (const name of posts) {
    const source = fs.readFileSync(path.join('source/_posts', name + '.md'), 'utf8');
    const expected = (source.match(/!\[[^\]]*\]\(\/images\/notes\/[^)]+\.svg\)/g) || []).length;
    const html = fs.readFileSync(path.join('public/notes', name, 'index.html'), 'utf8');
    const diagrams = html.match(/<svg\b[^>]*class="note-diagram"[^>]*>[\s\S]*?<\/svg>/g) || [];
    assert.equal(diagrams.length, expected, name + ' 的解释图应直接嵌入页面');
    assert.doesNotMatch(html, /<img\b[^>]*src="\/images\/notes\/[^"\s]+\.svg"/);
  }
});

test('同一篇文章的图不共用标记 ID，箭头和无障碍描述各自对应', () => {
  for (const name of posts) {
    const html = fs.readFileSync(path.join('public/notes', name, 'index.html'), 'utf8');
    const diagrams = html.match(/<svg\b[^>]*class="note-diagram"[^>]*>[\s\S]*?<\/svg>/g) || [];
    assert.ok(diagrams.length > 0);
    const pageIds = new Set();
    for (const svg of diagrams) {
      const localIds = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
      for (const id of localIds) {
        assert.ok(!pageIds.has(id), '图之间不应出现重复 ID：' + id);
        pageIds.add(id);
      }
      for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(localIds.has(ref[1]));
      for (const ref of svg.matchAll(/(?:xlink:)?href=["']#([^"']+)["']/g)) assert.ok(localIds.has(ref[1]));
      const labels = svg.match(/aria-labelledby="([^"]+)"/);
      assert.ok(labels);
      for (const id of labels[1].split(/\s+/)) assert.ok(localIds.has(id));
    }
  }
});

test('独立 SVG 的后备字体与正文衬线字体一致', () => {
  const css = fs.readFileSync('source/css/custom.css', 'utf8');
  const normalize = value => value.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  const expected = normalize(css.match(/--font-serif:\s*([^;]+);/)[1]);
  for (const dir of fs.readdirSync('source/images/notes').filter(name => fs.statSync(path.join('source/images/notes', name)).isDirectory())) {
    const folder = path.join('source/images/notes', dir);
    for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.svg'))) {
      const svg = fs.readFileSync(path.join(folder, name), 'utf8');
      const family = svg.match(/font-family="([^"]+)"/);
      assert.ok(family);
      assert.equal(normalize(family[1]), expected, name);
    }
  }
});

test('三张试作图各嵌入一次，紧凑布局使用同一字号下限与可编辑文字', () => {
  const diagrams = [
    ['OS笔记', 'operating-system/process-states.svg'],
    ['OS笔记', 'operating-system/race-condition-interleaving.svg'],
    ['数据库笔记', 'database/er-to-relational-tables.svg'],
  ];
  for (const [post, filename] of diagrams) {
    const source = fs.readFileSync(path.join('source/_posts', post + '.md'), 'utf8');
    const url = '/images/notes/' + filename;
    assert.equal(source.split('](' + url + ')').length - 1, 1, filename);
    const svg = fs.readFileSync(path.join('source', url), 'utf8');
    assert.match(svg, /viewBox="0 0 640 \d+"/);
    assert.match(svg, /data-layout="compact"/);
    assert.match(svg, /<title\b[^>]*>[^<]+<\/title>/);
    assert.match(svg, /<desc\b[^>]*>[^<]+<\/desc>/);
    assert.doesNotMatch(svg, /<(?:script|image|foreignObject)\b|\bhref=/i);
    const labels = [...svg.matchAll(/<text\b[^>]*font-size="([\d.]+)"[^>]*>[^<]+<\/text>/g)];
    assert.ok(labels.length > 10, filename + ' 应保留可编辑文字');
    for (const label of labels) assert.ok(Number(label[1]) >= 24, filename + ' 的文字不得过小');
  }
});

test('全部紧凑图保留可访问描述、可编辑文字与手机字号', () => {
  for (const dir of fs.readdirSync('source/images/notes')) {
    const folder = path.join('source/images/notes', dir);
    if (!fs.statSync(folder).isDirectory()) continue;
    for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.svg'))) {
      const svg = fs.readFileSync(path.join(folder, name), 'utf8');
      if (!svg.includes('data-layout="compact"')) continue;
      assert.match(svg, /viewBox="0 0 640 \d+"/, name);
      assert.match(svg, /role="img"/, name);
      assert.match(svg, /<title\b[^>]*>[^<]+<\/title>/, name);
      assert.match(svg, /<desc\b[^>]*>[^<]+<\/desc>/, name);
      assert.match(svg, /<text\b/, name);
      assert.doesNotMatch(svg, /<(?:script|image|foreignObject)\b|<!DOCTYPE/i, name);
      for (const ref of svg.matchAll(/(?:xlink:)?href=["']([^"']+)["']/g)) {
        assert.ok(ref[1].startsWith('#'), name + ' 只使用图内引用');
      }
      const sizes = [...svg.matchAll(/font-size(?:="|:\s*)([\d.]+)/g)].map(m => Number(m[1]));
      assert.ok(sizes.length > 0, name);
      for (const size of sizes) assert.ok(size >= 24, name + ' 的文字不得过小');
    }
  }
});
