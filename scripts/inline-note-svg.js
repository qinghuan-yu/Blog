const fs = require('node:fs');
const path = require('node:path');

// 将本站解释图嵌入文章，复用页面字体，并隔离各图的标记 ID。
hexo.extend.helper.register('inline_note_diagrams', function (content) {
  let index = 0;
  const images = /<img\b[^>]*\bsrc=(["'])(\/images\/notes\/(?:computer-organization|computer-network|operating-system|database)\/[a-z0-9-]+\.svg)\1[^>]*>/g;
  return content.replace(images, (image, quote, source) => {
    const filename = path.join(hexo.source_dir, source.slice(1));
    const prefix = 'note-diagram-' + index++ + '-';
    const svg = fs.readFileSync(filename, 'utf8')
      .replace(/^<\?xml[^?]*\?>\s*/, '')
      .replace(/\bid="([^"]+)"/g, (_, id) => 'id="' + prefix + id + '"')
      .replace(/url\(#([^)]+)\)/g, (_, id) => 'url(#' + prefix + id + ')')
      .replace(/aria-labelledby="([^"]+)"/g, (_, ids) =>
        'aria-labelledby="' + ids.split(/\s+/).map(id => prefix + id).join(' ') + '"');
    return svg.replace('<svg ', '<svg class="note-diagram" ');
  });
});
