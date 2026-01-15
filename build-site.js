const fs = require('fs');
const path = require('path');

// Pages to process (excluding index.html which has custom inline nav, and blog posts handled by build-blog.js)
const PAGES = [
  'faq.html',
  'privacy.html',
  'terms.html',
  'professionals.html',
  'blog.html'
];

// Read partials
const headerPartial = fs.readFileSync(path.join(__dirname, '_partials/header.html'), 'utf-8');
const footerPartial = fs.readFileSync(path.join(__dirname, '_partials/footer.html'), 'utf-8');

// Regex patterns to match nav and footer sections
const navRegex = /<nav class="nav">[\s\S]*?<\/nav>/;
const footerRegex = /<footer class="footer">[\s\S]*?<\/footer>\s*(<script>[\s\S]*?\/\/ Mobile menu toggle[\s\S]*?<\/script>)?/;

function processFile(filePath) {
  const fullPath = path.join(__dirname, filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`  Skipping (not found): ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');
  let modified = false;

  // Replace nav
  if (navRegex.test(content)) {
    content = content.replace(navRegex, headerPartial.trim());
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

console.log('Building site with partials (pre-launch)...\n');
console.log('Header partial loaded');
console.log('Footer partial loaded\n');

console.log('Processing pages:');
PAGES.forEach(processFile);

console.log('\nSite build complete!');
console.log('\nNote: index.html and teaser.html have custom styling - update manually if needed');
console.log('Note: Blog posts are handled by build-blog.js');
