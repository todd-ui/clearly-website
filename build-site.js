const fs = require('fs');
const path = require('path');

// Pages to process (excluding blog posts which are handled by build-blog.js)
const PAGES = [
  'faq.html',
  'help.html',
  'privacy.html',
  'terms.html',
  'professionals.html',
  'blog.html',
  'plan-builder/index.html',
  'communication-styles/index.html',
  'calculators/index.html',
  'co-parent-communication/index.html',
  'custody-schedule-help/index.html',
  'coparenting-alignment-guide/index.html',
  'kids-and-divorce/index.html',
  'mediation-prep/index.html',
  'co-parenting-expenses/index.html',
  'high-conflict-coparenting/index.html'
  // Note: index.html excluded - has its own inline header/footer
];

// Read partials
const headerPartial = fs.readFileSync(path.join(__dirname, '_partials/header.html'), 'utf-8');
const footerPartial = fs.readFileSync(path.join(__dirname, '_partials/footer.html'), 'utf-8');

// Regex patterns to match old or new header and footer sections
// Matches: skip-link + old <nav class="nav"> or new <header class="site-nav"> + mobile menu script
const headerRegex = /(<a href="#main-content"[^>]*>Skip to content<\/a>\s*)?(<nav class="nav">[\s\S]*?<\/nav>|<header class="site-nav">[\s\S]*?<\/header>)\s*(<script>[\s\S]*?\/\/ Mobile menu toggle[\s\S]*?<\/script>)?\s*(<script src="\/js\/access-modal\.js"[^>]*><\/script>)?/;
const footerRegex = /<footer class="(footer|site-footer)">[\s\S]*?<\/footer>\s*(<script>[\s\S]*?\/\/ Mobile menu toggle[\s\S]*?<\/script>)?/;

function processFile(filePath) {
  const fullPath = path.join(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`  Skipping (not found): ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  let modified = false;

  // Replace header (old nav or new site-nav)
  if (headerRegex.test(content)) {
    content = content.replace(headerRegex, headerPartial.trim());
    modified = true;
  }

  // Replace footer (including mobile menu script if present)
  if (footerRegex.test(content)) {
    content = content.replace(footerRegex, footerPartial.trim());
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(fullPath, content);
    console.log(`  Updated: ${filePath}`);
  } else {
    console.log(`  No changes: ${filePath}`);
  }
}

console.log('Building site with partials...\n');
console.log('Header partial loaded');
console.log('Footer partial loaded\n');

console.log('Processing pages:');
PAGES.forEach(processFile);

console.log('\nSite build complete!');
console.log('\nNote: Blog posts are handled by build-blog.js');
