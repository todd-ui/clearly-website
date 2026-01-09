# Child Support Calculator Maintenance Guide

This document provides instructions for maintaining and updating the child support calculators.

## Annual Review Schedule

A GitHub Action runs automatically on **January 1st** each year to create a review issue. You can also trigger it manually from the Actions tab.

### Review Checklist

Each year, verify the following for each state:

- [ ] Income caps and thresholds
- [ ] Percentage rates
- [ ] Schedule values (for income shares states)
- [ ] Self-support reserves and poverty guidelines
- [ ] Any legislative changes

---

## State-by-State Update Guide

### New York

**Update Frequency:** Every 2 years (January/February)

**Official Sources:**
- [NY Domestic Relations Law §240](https://www.nysenate.gov/legislation/laws/DOM/240)
- [NY Courts - Child Support Standards Chart](https://www.nycourts.gov/courthelp/family/childSupport.shtml)
- [NY OTDA - Self-Support Reserve](https://otda.ny.gov/programs/child-support/)

**Values to Check:**
- `incomeCap` - Combined parental income cap (updates every 2 years)
- `selfSupportReserve` - Annual self-support reserve amount
- `povertyGuideline` - Federal poverty guideline for single person
- CSSA percentages (rarely change: 17%, 25%, 29%, 31%, 35%)

**Current Period:** March 2024 - February 2026
**Next Update Expected:** March 2026

---

### California

**Update Frequency:** Rarely (formula-based)

**Official Sources:**
- [CA Family Code §4055](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4055.&lawCode=FAM)
- [CA Child Support Services](https://childsupport.ca.gov/)
- [Official CA Calculator](https://childsupport.ca.gov/guideline-calculator/)

**Values to Check:**
- K-factor multipliers for number of children
- Any legislative changes to the formula

**Note:** California uses an algebraic formula that rarely changes. The official state calculator should be referenced for complex cases.

---

### Texas

**Update Frequency:** Annually (September)

**Official Sources:**
- [TX Family Code §154.125](https://statutes.capitol.texas.gov/Docs/FA/htm/FA.154.htm#154.125)
- [TX Family Code §154.129](https://statutes.capitol.texas.gov/Docs/FA/htm/FA.154.htm#154.129) (Multiple families)
- [TX Attorney General Child Support](https://www.texasattorneygeneral.gov/child-support)

**Values to Check:**
- `incomeCap` - Monthly net resources cap (updates annually in September)
- Multiple family adjustment percentages

**Current Cap:** $11,700/month (effective September 2025)

---

### Florida

**Update Frequency:** Periodic (check annually)

**Official Sources:**
- [FL Statute 61.30](https://www.flsenate.gov/Laws/Statutes/2024/61.30)
- [FL Child Support Guidelines](https://www.flcourts.org/Resources-Services/Family-Courts/Family-Law-Self-Help-Information/Child-Support)

**Values to Check:**
- Support schedule (FL_SCHEDULE brackets in the code)
- Percentages for income over $10,000
- Substantial time-sharing threshold (currently 20%/73 overnights)

**Note:** Florida's schedule is embedded in the statute. Check for legislative amendments.

---

### Illinois

**Update Frequency:** Periodic (check annually)

**Official Sources:**
- [750 ILCS 5/505](https://www.ilga.gov/legislation/ilcs/ilcs4.asp?ActID=2086&ChapterID=59&SeqStart=8100000&SeqEnd=9800000)
- [IL HFS Child Support](https://hfs.illinois.gov/childsupport.html)
- [IL Income Shares Schedule](https://hfs.illinois.gov/childsupport/parents/702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702.html)

**Values to Check:**
- Support schedule (IL_SCHEDULE brackets)
- Low-income threshold (75% of federal poverty level)
- Low-income amounts per child
- Shared custody threshold (currently 40%/146 overnights)

---

### Pennsylvania

**Update Frequency:** Periodic (check annually)

**Official Sources:**
- [231 Pa. Code Rule 1910.16-3](https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/chapter1910/s1910.16-3.html)
- [PA Courts Child Support](https://www.pacourts.us/forms/for-the-public/child-support-forms)

**Values to Check:**
- Support schedule (PA_SCHEDULE brackets)
- Income cap for schedule
- Shared custody threshold (currently 40%/146 overnights)

**Note:** Schedule was last amended August 2025, effective January 2026.

---

## How to Update a Calculator

### Step 1: Update the Config File

Edit `/calculators/calculator-config.js`:

```javascript
"new-york": {
  lastUpdated: "2026-03-15",  // Update this date
  guidelinesEffective: "March 2026 - February 2028",  // Update period
  nextReviewDate: "2028-02-01",  // Update next review
  values: {
    incomeCap: 195000,  // Update the value
    // ... other values
  }
}
```

### Step 2: Update the Calculator HTML

If schedule data is embedded in the HTML file (FL, IL, PA), update those values directly in the respective HTML file.

Update the `dateModified` in the structured data:
```html
<script type="application/ld+json">
{
  ...
  "dateModified": "2026-03-15"
}
</script>
```

### Step 3: Test the Calculator

1. Open the calculator locally
2. Enter sample values and verify calculations
3. Compare results with official state calculators if available

### Step 4: Update Version Banner

The version banner should automatically reflect changes from the config file. Verify it displays correctly.

### Step 5: Commit Changes

```bash
git add calculators/
git commit -m "Update [STATE] calculator for [YEAR] guidelines"
git push
```

---

## Official State Calculator Links (for verification)

| State | Official Calculator |
|-------|---------------------|
| New York | [NYCourts.gov](https://www.nycourts.gov/courthelp/family/childSupport.shtml) |
| California | [childsupport.ca.gov](https://childsupport.ca.gov/guideline-calculator/) |
| Texas | [texasattorneygeneral.gov](https://www.texasattorneygeneral.gov/child-support/child-support-calculator) |
| Florida | [flcourts.org](https://www.flcourts.org/Resources-Services/Family-Courts/Family-Law-Self-Help-Information/Child-Support) |
| Illinois | [hfs.illinois.gov](https://hfs.illinois.gov/childsupport.html) |
| Pennsylvania | [pacourts.us](https://www.pacourts.us/forms/for-the-public/child-support-forms) |

---

## Contact

For questions about calculator maintenance, contact the development team or create a GitHub issue.

Last updated: January 2025
