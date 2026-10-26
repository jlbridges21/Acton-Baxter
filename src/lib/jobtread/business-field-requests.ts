/**
 * Business fields requested in JobTread_Custom_Fields.xlsx (sheet "Current Custom Fields",
 * 92 rows), the authoritative list for Reports → Data settings → Business fields.
 * Imported once into jt_semantic_fields; after that admins manage the list in the web app.
 * The sheet has no JobTread ids: ids come from the synced field metadata (see business-fields.ts).
 */

export type RequestedBusinessField = {
  category: RequestedCategory;
  name: string;
  type: RequestedType;
  options: string[];
};

export const REQUESTED_CATEGORIES = [
  "Customer Accounts",
  "Customer Contacts",
  "Locations",
  "Jobs",
  "Cost Items",
  "Daily Logs",
  "Vendor Accounts",
  "Vendor Contacts",
] as const;
export type RequestedCategory = (typeof REQUESTED_CATEGORIES)[number];

export const REQUESTED_TYPES = [
  "Date",
  "Dropdown",
  "Email",
  "Number",
  "Phone",
  "Text",
  "URL",
] as const;
export type RequestedType = (typeof REQUESTED_TYPES)[number];

type Row = [RequestedCategory, string, RequestedType, string];

/** [category, field name, field type, dropdown options separated by "; "] — verbatim from the sheet. */
const ROWS: Row[] = [
  [
    "Customer Accounts",
    "Lead Source",
    "Dropdown",
    "Angi; Facebook; Google; Home Advisor; Instagram; Insurance; Internet Search; Referral; Trade Show; Website",
  ],
  ["Customer Accounts", "Referral Source", "Text", ""],
  [
    "Customer Accounts",
    "Lead Status",
    "Dropdown",
    "New; Contacted; Qualified; Unqualified; Converted",
  ],
  ["Customer Accounts", "Customer Type", "Dropdown", "Homeowner; Investor; Developer; Other"],
  ["Customer Accounts", "Budget & Context", "Text", ""],
  ["Customer Accounts", "Customer Story & Goals", "Text", ""],
  ["Customer Accounts", "Priorities & Concerns", "Text", ""],
  ["Customer Accounts", "Decision Process & Involvement", "Text", ""],
  ["Customer Accounts", "Sales Scope & Commitments", "Text", ""],
  ["Customer Accounts", "Schedule Goals & Next Steps", "Text", ""],
  ["Customer Accounts", "Internal Strategy & Intelligence", "Text", ""],
  ["Customer Accounts", "Marketing & Cancellation", "Text", ""],
  ["Customer Accounts", "Customer Account Notes", "Text", ""],
  ["Customer Contacts", "Email", "Email", ""],
  ["Customer Contacts", "Phone", "Phone", ""],
  ["Customer Contacts", "Name Pronunciation", "Text", ""],
  [
    "Customer Contacts",
    "Contact Role",
    "Dropdown",
    "Owner; Spouse / Partner; Representative; Other",
  ],
  ["Customer Contacts", "Primary Decision Maker", "Dropdown", "Yes; No; Unknown"],
  ["Customer Contacts", "Communication Preferences", "Text", ""],
  ["Customer Contacts", "Customer Contact Notes", "Text", ""],
  ["Locations", "APN", "Text", ""],
  [
    "Locations",
    "Climate Zone",
    "Dropdown",
    "1; 2; 3; 4; 5; 6; 7; 8; 9; 10; 11; 12; 13; 14; 15; 16; Unknown",
  ],
  ["Locations", "Zoning", "Text", ""],
  ["Locations", "Site, Access & Accessibility", "Text", ""],
  ["Locations", "City Feedback & Special Requirements", "Text", ""],
  ["Locations", "WUI Zone", "Dropdown", "Yes; No; Check; Unknown"],
  ["Locations", "Main Home Sprinklers", "Dropdown", "No; Yes; Check; Unknown"],
  ["Locations", "ADU Sprinklers Required", "Dropdown", "No; Yes; Check; Unknown"],
  ["Locations", "Arborist Required", "Dropdown", "No; Yes; Check; Unknown"],
  ["Locations", "Flood Study Required", "Dropdown", "No; Yes; Check; Unknown"],
  ["Locations", "Soils Report Required", "Dropdown", "Yes; No; Check; Unknown"],
  ["Locations", "Solar Required", "Dropdown", "No; Yes; Check; Unknown"],
  ["Locations", "Curb to ADU (ft)", "Number", ""],
  ["Locations", "Hydrant to Curb (ft)", "Number", ""],
  ["Locations", "Trench Length (ft)", "Number", ""],
  ["Locations", "Existing Home & Foundation", "Text", ""],
  ["Locations", "Electrical Service & Scope", "Text", ""],
  ["Locations", "Water Service & Scope", "Text", ""],
  ["Locations", "Sewer & Trench Scope", "Text", ""],
  ["Locations", "Location Notes", "Text", ""],
  ["Jobs", "Status", "Dropdown", "Open; Closed; Warranty; Test; Product Library"],
  [
    "Jobs",
    "Phase",
    "Dropdown",
    "BR-Estimating; BR-Design; BR-Permitting; BR-Production; Custom-Estimating; Custom-Design; Custom-Permitting; Custom-Production; Warranty; Canceled; Complete; Test; Product Library",
  ],
  [
    "Jobs",
    "Job Type",
    "Dropdown",
    "ADU; Remodel; Custom ADU; Other - Residential Homebuilder; BR - Investor Series; Other - Residential Remodeler; BR - Signature Series; BR - Age in Place Series; BR - Bonus Series; Attached ADU; Detached Garage",
  ],
  ["Jobs", "Contract Type", "Dropdown", "Fixed; Design Billing"],
  ["Jobs", "Feasibility Project Manager", "Dropdown", "Connor; Kevin; Stan"],
  [
    "Jobs",
    "Sales Rep",
    "Dropdown",
    "Kevin; Stan; Jesse; Connor; Jesse, Connor; Dane, Kevin; Jesse, Kevin; Kevin, Jesse; Kevin, Connor; Dane",
  ],
  ["Jobs", "Project Manager", "Dropdown", "Maxx; Rebecca; Connor; Zac"],
  ["Jobs", "Design Coordinator", "Dropdown", "Jess; Lynne; Aws; Tony"],
  ["Jobs", "Drafter", "Dropdown", "Aws; Bryan; Lynne; Aws, Bryan; Aws, Lynne"],
  ["Jobs", "Site Supervisor", "Dropdown", "Zac; Dave; Gino"],
  ["Jobs", "Model & Series", "Text", ""],
  ["Jobs", "Total Sqft", "Number", ""],
  ["Jobs", "Bed / Bath Count", "Text", ""],
  ["Jobs", "Permit Number", "Text", ""],
  ["Jobs", "Permit Status", "Dropdown", "Not Submitted; Submitted; Comments Received; Approved"],
  ["Jobs", "Design Status", "Text", ""],
  ["Jobs", "Exterior Package", "Text", ""],
  ["Jobs", "Interior Package", "Text", ""],
  ["Jobs", "Selection Status", "Text", ""],
  ["Jobs", "Design Handoff", "Text", ""],
  ["Jobs", "Production Handoff", "Text", ""],
  ["Jobs", "Site Access Information", "Text", ""],
  ["Jobs", "Job Notes", "Text", ""],
  ["Cost Items", "Cost Item Notes", "Text", ""],
  ["Daily Logs", "Work Performed", "Text", ""],
  ["Daily Logs", "Trades On Site", "Text", ""],
  ["Daily Logs", "Inspection", "Text", ""],
  ["Daily Logs", "Inspection Result", "Dropdown", "Passed; Failed; Partial; Pending"],
  ["Daily Logs", "Conditions & Impacts", "Text", ""],
  ["Daily Logs", "Customer Communication", "Text", ""],
  ["Daily Logs", "Follow-Up Required", "Dropdown", "Yes; No; Unknown; Check"],
  ["Daily Logs", "Follow-Up Notes", "Text", ""],
  ["Daily Logs", "Daily Log Notes", "Text", ""],
  ["Vendor Accounts", "Email", "Email", ""],
  ["Vendor Accounts", "Phone", "Phone", ""],
  [
    "Vendor Accounts",
    "Trade Type",
    "Dropdown",
    "General Contractor; Carpentry; Concrete; Demolition; Design; Electrical; Engineering; Excavation; Foundation; Framing, Siding, Walls; Geotech & Soils; HVAC; Inspections; Landscaping; Masonry; Metals; Painting; Plumbing; Professional Services; Rentals; Roofing; Tile; Stone; Other; Gutters; Mechanical; Insulation; Boundary Survey; Asphalt; Specialties; Landscape; Asbestos Abetment; Paint; Cabinetry; Drywall; Tile & Stone; Finishes; Framing; Decking; Wood & Plastics; Material; Doors & Windows; Structural; Utilities; Fire Sprinklers; Millwork; Supplier; General Requirements; Appliances; Trenching; Stucco; Shower Glass; Openings; Trusses; Pools; Waterproofing; Flooring; Awnings; Furniture & Ornamental Steel; Scaffold; Civil Engineer; MEP Engineer",
  ],
  ["Vendor Accounts", "Website", "URL", ""],
  ["Vendor Accounts", "Vendor Status", "Dropdown", "Active; Inactive; Under Review"],
  ["Vendor Accounts", "Preferred Vendor", "Dropdown", "Yes; No; Unknown"],
  ["Vendor Accounts", "Open to Bidding", "Dropdown", "Yes; No; Unknown"],
  [
    "Vendor Accounts",
    "Service Areas",
    "Dropdown",
    "L.A.; East Bay; South Bay; North Bay; Florida - Tampa",
  ],
  ["Vendor Accounts", "W-9 on File", "Dropdown", "No; Yes; Unknown"],
  ["Vendor Accounts", "COI Expiration", "Date", ""],
  ["Vendor Accounts", "License Number", "Text", ""],
  ["Vendor Accounts", "License Expiration", "Date", ""],
  [
    "Vendor Accounts",
    "Vendor Rating",
    "Dropdown",
    "5 - Excellent; 4 - Above Average; 3 - Average; 2 - Below Average; 1 - Do Not Use",
  ],
  ["Vendor Accounts", "Vendor Account Notes", "Text", ""],
  ["Vendor Contacts", "Email", "Email", ""],
  ["Vendor Contacts", "Phone", "Phone", ""],
  [
    "Vendor Contacts",
    "Contact Roles",
    "Dropdown",
    "Owner; Project Manager; Estimator; Office; Other",
  ],
  ["Vendor Contacts", "Preferred Contact Method", "Dropdown", "Email; Phone; Text"],
  ["Vendor Contacts", "Vendor Contact Notes", "Text", ""],
];

export const REQUESTED_BUSINESS_FIELDS: RequestedBusinessField[] = ROWS.map(
  ([category, name, type, options]) => ({
    category,
    name,
    type,
    options: options ? options.split("; ") : [],
  }),
);
