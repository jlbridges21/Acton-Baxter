/**
 * Fixture approximating Sales Performance Report — Trailing 2 Years
 * (title/summary rows, then real headers, then Lori Harris + summary metrics).
 */
export function salesPerformanceReportFixture() {
  const salesReport: string[][] = [
    ["Sales Performance Report — Trailing 2 Years", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["Total Contracts", "27", "", "", "", "", "", "", ""],
    ["Total Agreement Value", "$13,194,967", "", "", "", "", "", "", ""],
    ["Total Internal Cost", "$9,392,807", "", "", "", "", "", "", ""],
    ["Total Gross Margin", "$3,802,161", "", "", "", "", "", "", ""],
    ["Avg Margin %", "28.9%", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    [
      "Internal Cost reflects our estimated cost of delivery, not final actuals.",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
    ["", "", "", "", "", "", "", "", ""],
    [
      "Customer Name",
      "Project",
      "Close Date",
      "Project Sq Ft",
      "Agreement Amount",
      "Internal Cost (Est.)",
      "Estimated Gross Margin $",
      "Gross Margin %",
      "Project Type (BR/Custom)",
    ],
    [
      "Lori Harris",
      "Lori Harris - Detached ADU",
      "Mar 27, 2025",
      "559 sf",
      "$352,933",
      "$258,241",
      "$94,692",
      "26.8%",
      "Custom",
    ],
    [
      "Alex Nguyen",
      "Nguyen - BR ADU",
      "Jan 10, 2025",
      "480 sf",
      "$289,000",
      "$210,000",
      "$79,000",
      "27.3%",
      "BR",
    ],
    [
      "Sam Patel",
      "Patel Custom ADU",
      "Mar 5, 2026",
      "620 sf",
      "$401,200",
      "$295,000",
      "$106,200",
      "26.5%",
      "Custom",
    ],
    [
      "Jordan Lee",
      "Lee BR ADU",
      "Feb 14, 2026",
      "500 sf",
      "$318,500",
      "$230,000",
      "$88,500",
      "27.8%",
      "BR",
    ],
    [
      "Casey Morgan",
      "Morgan Detached",
      "Jun 2, 2026",
      "580 sf",
      "$365,000",
      "$268,000",
      "$97,000",
      "26.6%",
      "Custom",
    ],
  ];

  const rawData: string[][] = [
    [
      "Opportunity name",
      "Customer Name",
      "Close Date",
      "Agreement Amount",
      "Project Type (BR/Custom)",
    ],
    ["Lori Harris - Detached ADU", "Lori Harris", "Mar 27, 2025", "$352,933", "Custom"],
    ["Nguyen - BR ADU", "Alex Nguyen", "Jan 10, 2025", "$289,000", "BR"],
    ["Patel Custom ADU", "Sam Patel", "Mar 5, 2026", "$401,200", "Custom"],
    ["Lee BR ADU", "Jordan Lee", "Feb 14, 2026", "$318,500", "BR"],
  ];

  return {
    title: "Sales Performance Report — Trailing 2 Years",
    sheets: [
      { name: "Sales Report", gid: 1156599217, grid: salesReport },
      { name: "Raw Data", gid: 2, grid: rawData },
    ],
  };
}
