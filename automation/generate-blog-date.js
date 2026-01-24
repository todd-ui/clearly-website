/**
 * Blog Post Date Generator
 * Generates random publish dates for blog posts
 *
 * Usage: node generate-blog-date.js [range]
 * Ranges: "recent" | "3months" | "6months" | "year"
 */

function generateRandomDate(range = '3months') {
  const now = new Date();
  let minDaysAgo, maxDaysAgo;

  switch (range) {
    case 'recent':
      minDaysAgo = 1;
      maxDaysAgo = 14;
      break;
    case '3months':
      minDaysAgo = 7;
      maxDaysAgo = 90;
      break;
    case '6months':
      minDaysAgo = 90;
      maxDaysAgo = 180;
      break;
    case 'year':
      minDaysAgo = 30;
      maxDaysAgo = 365;
      break;
    default:
      minDaysAgo = 7;
      maxDaysAgo = 90;
  }

  const daysAgo = Math.floor(Math.random() * (maxDaysAgo - minDaysAgo + 1)) + minDaysAgo;
  const date = new Date(now);
  date.setDate(date.getDate() - daysAgo);

  return {
    iso: date.toISOString().split('T')[0],
    formatted: date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    daysAgo: daysAgo
  };
}

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateBlogMetadata(title, category, range = '3months') {
  const date = generateRandomDate(range);
  const slug = generateSlug(title);

  return {
    title,
    slug,
    category,
    date: date.iso,
    dateFormatted: date.formatted,
    notionDate: date.iso,
    url: `https://getclearly.app/blog/${slug}.html`
  };
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Just generate a random date
    const range = '3months';
    const date = generateRandomDate(range);
    console.log('\n📅 Generated Blog Post Date');
    console.log('─'.repeat(30));
    console.log(`Range:     ${range}`);
    console.log(`Date:      ${date.formatted}`);
    console.log(`ISO:       ${date.iso}`);
    console.log(`Days ago:  ${date.daysAgo}`);
    console.log('');
  } else if (args[0] === '--help') {
    console.log(`
Blog Post Date Generator

Usage:
  node generate-blog-date.js                    Generate random date (last 3 months)
  node generate-blog-date.js recent             Generate date (last 2 weeks)
  node generate-blog-date.js 3months            Generate date (last 3 months)
  node generate-blog-date.js 6months            Generate date (3-6 months ago)
  node generate-blog-date.js year               Generate date (last year)
  node generate-blog-date.js --meta "Title"     Generate full metadata

Examples:
  node generate-blog-date.js recent
  node generate-blog-date.js --meta "How to Handle Schedule Changes" "Communication" 3months
`);
  } else if (args[0] === '--meta') {
    const title = args[1] || 'Untitled Post';
    const category = args[2] || 'Co-Parenting Basics';
    const range = args[3] || '3months';

    const meta = generateBlogMetadata(title, category, range);

    console.log('\n📝 Blog Post Metadata');
    console.log('─'.repeat(40));
    console.log(`Title:     ${meta.title}`);
    console.log(`Slug:      ${meta.slug}`);
    console.log(`Category:  ${meta.category}`);
    console.log(`Date:      ${meta.dateFormatted}`);
    console.log(`ISO Date:  ${meta.date}`);
    console.log(`URL:       ${meta.url}`);
    console.log('');
    console.log('For Notion:');
    console.log(`  Title: ${meta.title}`);
    console.log(`  Slug: ${meta.slug}`);
    console.log(`  Date: ${meta.date}`);
    console.log(`  Category: ${meta.category}`);
    console.log('');
  } else {
    const range = args[0];
    const date = generateRandomDate(range);
    console.log('\n📅 Generated Blog Post Date');
    console.log('─'.repeat(30));
    console.log(`Range:     ${range}`);
    console.log(`Date:      ${date.formatted}`);
    console.log(`ISO:       ${date.iso}`);
    console.log(`Days ago:  ${date.daysAgo}`);
    console.log('');
  }
}

module.exports = { generateRandomDate, generateSlug, generateBlogMetadata };
