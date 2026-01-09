/**
 * Clearly Child Support Calculator Configuration
 *
 * This centralized configuration file contains all state-specific values,
 * effective dates, and source references for the child support calculators.
 *
 * MAINTENANCE: Review this file annually (January) or when state guidelines change.
 * See MAINTENANCE.md for update instructions and official source links.
 */

const CALCULATOR_CONFIG = {
  // Global metadata
  version: "1.0.0",
  lastGlobalUpdate: "2025-01-09",

  // State configurations
  states: {
    "new-york": {
      name: "New York",
      abbreviation: "NY",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "March 2024 - February 2026",
      nextReviewDate: "2026-02-01",
      source: "NY Domestic Relations Law §236, §240",
      sourceUrl: "https://www.nysenate.gov/legislation/laws/DOM",
      notes: "Income cap updates every 2 years in January/February",
      values: {
        incomeCap: 183000,
        childSupportPercentages: {
          1: 0.17,
          2: 0.25,
          3: 0.29,
          4: 0.31,
          5: 0.35
        },
        selfSupportReserve: 21128,
        povertyGuideline: 15650,
        ficaRate: 0.0765,
        maintenanceFormulas: {
          withChildren: { payorPct: 0.20, payeePct: 0.25 },
          withoutChildren: { payorPct: 0.30, payeePct: 0.20 }
        }
      }
    },

    "california": {
      name: "California",
      abbreviation: "CA",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "2024 (SB 343)",
      nextReviewDate: "2026-01-01",
      source: "California Family Code Section 4055",
      sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4055.&lawCode=FAM",
      notes: "Uses algebraic K-factor formula. Values rarely change.",
      values: {
        kMultipliers: {
          1: 1.0,
          2: 1.6,
          3: 2.0,
          4: 2.3,
          5: 2.5
        }
      }
    },

    "texas": {
      name: "Texas",
      abbreviation: "TX",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "September 2025",
      nextReviewDate: "2025-09-01",
      source: "Texas Family Code §154.125, §154.129",
      sourceUrl: "https://statutes.capitol.texas.gov/Docs/FA/htm/FA.154.htm",
      notes: "Income cap updates annually in September",
      values: {
        incomeCap: 11700,
        standardPercentages: {
          1: 0.20,
          2: 0.25,
          3: 0.30,
          4: 0.35,
          5: 0.40
        },
        multipleFamily: {
          1: { 0: 0.20, 1: 0.175, 2: 0.16, 3: 0.1475, 4: 0.136, 5: 0.1333 },
          2: { 0: 0.25, 1: 0.225, 2: 0.2063, 3: 0.19, 4: 0.1838, 5: 0.1786 },
          3: { 0: 0.30, 1: 0.2738, 2: 0.252, 3: 0.24, 4: 0.2314, 5: 0.225 },
          4: { 0: 0.35, 1: 0.3222, 2: 0.30, 3: 0.2867, 4: 0.28, 5: 0.2722 },
          5: { 0: 0.40, 1: 0.3733, 2: 0.35, 3: 0.3367, 4: 0.3271, 5: 0.32 }
        }
      }
    },

    "florida": {
      name: "Florida",
      abbreviation: "FL",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "2024",
      nextReviewDate: "2026-01-01",
      source: "Florida Statute 61.30",
      sourceUrl: "https://www.flsenate.gov/Laws/Statutes/2024/61.30",
      notes: "Income shares model with schedule. Check for legislative updates.",
      values: {
        overTenKPercentages: {
          1: 0.05,
          2: 0.075,
          3: 0.095,
          4: 0.11,
          5: 0.12,
          6: 0.128
        },
        substantialTimeSharingThreshold: 73 // 20% of 365 days
      }
    },

    "illinois": {
      name: "Illinois",
      abbreviation: "IL",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "2025",
      nextReviewDate: "2026-01-01",
      source: "750 ILCS 5/505",
      sourceUrl: "https://hfs.illinois.gov/childsupport/parents/702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702702.html",
      notes: "Income shares model. Low-income provisions apply below 75% FPL.",
      values: {
        incomeCap: 30025,
        lowIncomeThreshold: 1295,
        lowIncomePerChild: 40,
        lowIncomeMax: 120,
        grossToNet: 0.72,
        sharedCustodyThreshold: 146 // 40% of 365 days
      }
    },

    "pennsylvania": {
      name: "Pennsylvania",
      abbreviation: "PA",
      lastUpdated: "2025-01-09",
      guidelinesEffective: "January 2026",
      nextReviewDate: "2026-01-01",
      source: "231 Pa. Code Rule 1910.16-3",
      sourceUrl: "https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/231/chapter1910/s1910.16-3.html",
      notes: "Income shares model. Schedule amended August 2025, effective January 2026.",
      values: {
        incomeCap: 30000,
        sharedCustodyThreshold: 146 // 40% of 365 days
      }
    }
  }
};

// Helper function to get state config
function getStateConfig(stateSlug) {
  return CALCULATOR_CONFIG.states[stateSlug] || null;
}

// Helper function to format date for display
function formatUpdateDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Export for use in calculators
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CALCULATOR_CONFIG, getStateConfig, formatUpdateDate };
}
