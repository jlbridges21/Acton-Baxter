/**
 * Garage Conversion checklist seed — built from the Acton ADU
 * "Garage Conversion Site Inspection SOP" (Project Management).
 *
 * Inserted as editable DB rows, not UI constants, so PMs can adjust it in
 * /inspections/templates without a deploy.
 *
 * Section order follows the SOP, which matches its own PM field standard:
 * SITE → ACCESS → STRUCTURE → OPENINGS → ROOF → PROPERTY LINE → UTILITIES →
 * FLOOR/ELEVATIONS → MOISTURE → DRAINAGE → EXISTING CONDITIONS →
 * COST-SAVING → PHOTOS → RED FLAGS.
 *
 * The SOP's "do not assume" guardrails are carried into guide notes verbatim —
 * they are the parts a PM is most likely to get wrong in front of a customer.
 */

import type { SeedTemplateInput } from "./types";

function notes(...bullets: string[]): string {
  return bullets.map((b) => `• ${b}`).join("\n");
}

export const GARAGE_CONVERSION_TEMPLATE_NAME = "Garage Conversion";

export const GARAGE_CONVERSION_SEED: SeedTemplateInput = {
  name: GARAGE_CONVERSION_TEMPLATE_NAME,
  description:
    "Site inspection checklist for garage conversion projects. Leave the property knowing what exists, what can be reused, what needs to change, and what remains unknown.",
  standaloneItems: [
    {
      title: "Front Photo of Garage",
      guideNotes: notes(
        "PHOTO: Capture a clear, straight-on view of the garage from the street for use as the inspection cover photo.",
      ),
      isCoverPhotoSource: true,
    },
  ],
  sections: [
    {
      title: "BEFORE ARRIVING ON SITE",
      items: [
        {
          title: "Review Project Information",
          guideNotes: notes(
            "Existing survey",
            "Proposed site plan",
            "Proposed ADU floor plan, if available",
            "Existing project photos",
            "Property lines and setbacks",
            "Known utility locations",
            "Customer requests or concerns",
            "Jurisdiction, if known",
          ),
        },
        {
          title: "Equipment Check",
          guideNotes: notes(
            "Tape measure",
            "Laser measure, if available",
            "Level",
            "Flashlight",
            "Phone/camera",
            "Plans and survey",
            "Inspection notes/checklist",
          ),
        },
      ],
    },
    {
      title: "SITE OVERVIEW & PROPERTY CHARACTERISTICS",
      items: [
        {
          title: "Garage Location & Relationship to Main House",
          guideNotes: notes(
            "Walk the property and evaluate the overall site before entering the garage",
            "Garage location",
            "Attached vs. detached garage",
            "Relationship to main house",
          ),
        },
        {
          title: "Property Lines & Existing Setbacks",
          guideNotes: notes("Property lines", "Existing setbacks", "Adjacent structures"),
        },
        {
          title: "Site Features",
          guideNotes: notes(
            "Driveway",
            "Side-yard access",
            "Gates",
            "Fences",
            "Landscaping",
            "Trees and stumps",
            "Retaining walls",
            "Existing utilities",
            "Equipment access",
          ),
        },
        {
          title: "Drainage & Grade Changes",
          guideNotes: notes("Drainage", "Grade changes"),
        },
        {
          title: "Site Photos",
          guideNotes: notes(
            "PHOTOS: Take photos showing the garage in relation to:",
            "Main house",
            "Property lines",
            "Driveway",
            "Adjacent structures",
            "Yard",
            "Street",
          ),
        },
      ],
    },
    {
      title: "SITE ACCESS",
      items: [
        {
          title: "Access Measurements",
          guideNotes: notes(
            "Determine how construction crews, equipment, materials, and debris will access the garage",
            "Note any other restricted access points in the notes",
          ),
          subQuestions: [
            { prompt: "Driveway width", questionType: "text" },
            { prompt: "Gate width", questionType: "text" },
            { prompt: "Side-yard width", questionType: "text" },
          ],
        },
        {
          title: "Equipment & Material Access",
          guideNotes: notes("Photograph all restricted access conditions."),
          subQuestions: [
            { prompt: "Can a mini excavator access the garage?", questionType: "yes_no_na" },
            {
              prompt: "Can materials be delivered directly to the garage?",
              questionType: "yes_no_na",
            },
            {
              prompt: "Will materials need to be carried through the house?",
              questionType: "yes_no_na",
            },
          ],
        },
        {
          title: "Staging, Debris & Trenching",
          guideNotes: notes("Photograph all restricted access conditions."),
          subQuestions: [
            { prompt: "Is there room for a dumpster?", questionType: "yes_no_na" },
            { prompt: "Is there room for material staging?", questionType: "yes_no_na" },
            { prompt: "Is concrete removal practical?", questionType: "yes_no_na" },
            { prompt: "Is there a clear trenching route?", questionType: "yes_no_na" },
          ],
        },
        {
          title: "Access Red Flags",
          guideNotes: notes(
            "Flag any of the following:",
            "Narrow gates",
            "Narrow side yards",
            "Steep slopes",
            "Limited staging",
            "Shared driveways",
            "No equipment access",
            "Difficult concrete removal access",
          ),
          subQuestions: [
            {
              prompt: "Access red flags present",
              questionType: "multi_select",
              options: [
                { label: "Narrow gates" },
                { label: "Narrow side yards" },
                { label: "Steep slopes" },
                { label: "Limited staging" },
                { label: "Shared driveway" },
                { label: "No equipment access" },
                { label: "Difficult concrete removal access" },
                { label: "None" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "ATTACHED VS. DETACHED GARAGE",
      items: [
        {
          title: "Garage Type",
          guideNotes: notes("Confirm whether the garage is attached or detached."),
          subQuestions: [
            {
              prompt: "Garage type",
              questionType: "single_select",
              options: [{ label: "Attached" }, { label: "Detached" }],
            },
          ],
        },
        {
          title: "Attached Garage — Conditions",
          guideNotes: notes(
            "Complete only if the garage is attached. Pay particular attention to:",
            "Connection to the main house",
            "Existing step-down elevation",
            "Fire separation",
            "Shared walls",
            "Shared utilities",
            "Existing house wall conditions",
            "Noise transfer",
            "Structural connections",
          ),
        },
        {
          title: "Detached Garage — Conditions",
          guideNotes: notes(
            "Complete only if the garage is detached. Pay particular attention to:",
            "Existing footings",
            "Slab condition",
            "Structural condition",
            "Sewer connection",
            "Water connection",
            "Electrical service",
            "Utility trenching",
            "Site access",
            "Drainage",
            "Grade changes",
          ),
        },
      ],
    },
    {
      title: "GARAGE MEASUREMENTS",
      items: [
        {
          title: "Exterior & Interior Dimensions",
          guideNotes: notes("Record the existing dimensions."),
          subQuestions: [
            { prompt: "Exterior length", questionType: "text" },
            { prompt: "Exterior width", questionType: "text" },
            { prompt: "Interior length", questionType: "text" },
            { prompt: "Interior width", questionType: "text" },
          ],
        },
        {
          title: "Curb Width",
          guideNotes: notes(
            "Determines the proposed ADU wall thickness.",
            "Typically 6 inches in modern construction, but verify the actual dimension on site.",
          ),
          subQuestions: [{ prompt: "Curb width", questionType: "text" }],
        },
        {
          title: "Ceiling Height",
          guideNotes: notes("Measure and record ceiling height."),
          subQuestions: [{ prompt: "Ceiling height", questionType: "text" }],
        },
        {
          title: "Garage Door Dimensions",
          guideNotes: notes("Measure the existing garage door."),
          subQuestions: [
            { prompt: "Garage door width", questionType: "text" },
            { prompt: "Garage door height", questionType: "text" },
          ],
        },
        {
          title: "Existing Window & Door Dimensions",
          guideNotes: notes("Record existing window dimensions", "Record existing door dimensions"),
        },
        {
          title: "Elevations",
          guideNotes: notes(
            "Document the relationship between:",
            "Garage slab",
            "Main house floor",
            "Exterior grade",
            "Driveway",
            "Adjacent yard",
            "Pay particular attention to any significant step-up or step-down conditions.",
          ),
        },
      ],
    },
    {
      title: "SLAB",
      items: [
        {
          title: "Slab Condition",
          guideNotes: notes(
            "Inspect the entire garage floor. Look for:",
            "Cracks",
            "Settlement",
            "Differential movement",
            "Spalling",
            "Patching",
            "Moisture",
            "Efflorescence",
            "Floor drains",
            "Penetrations",
            "Uneven areas",
          ),
        },
        {
          title: "Slab Slope & Elevation",
          guideNotes: notes(
            "Garage slabs commonly slope toward the garage door.",
            "Measure or document noticeable slope and elevation differences.",
            "IMPORTANT: Do not automatically assume the slab needs to be removed or leveled. Document the existing condition and allow Design/Estimating to determine the appropriate construction assembly.",
          ),
        },
      ],
    },
    {
      title: "FOOTINGS & FOUNDATION",
      items: [
        {
          title: "Footing & Foundation Condition",
          guideNotes: notes(
            "Determine whether the existing footing condition is known. Look for:",
            "Exposed footings",
            "Visible foundation",
            "Cracking",
            "Settlement",
            "Separation",
            "Leaning walls",
            "Previous structural work",
            "Pay particular attention to older detached garages where footing construction is unknown.",
            "Flag any condition that raises questions about whether the existing structure can support the proposed ADU conversion.",
            "IMPORTANT: Do not represent an existing footing as adequate unless it has been verified through the appropriate process.",
          ),
          subQuestions: [
            { prompt: "Is the existing footing condition known?", questionType: "yes_no_na" },
          ],
        },
      ],
    },
    {
      title: "WALLS",
      items: [
        {
          title: "Wall Condition",
          guideNotes: notes(
            "Inspect each wall individually. Look for:",
            "Rot",
            "Termite damage",
            "Water damage",
            "Cracks",
            "Bowing",
            "Leaning",
            "Damaged framing",
            "Previous modifications",
            "Existing openings",
            "PHOTOS: Photograph each wall and any condition that may require repair or structural modification.",
          ),
        },
      ],
    },
    {
      title: "GARAGE DOOR OPENING",
      items: [
        {
          title: "Garage Door Opening — Measurements",
          guideNotes: notes("Document the existing garage door opening."),
          subQuestions: [
            { prompt: "Opening width", questionType: "text" },
            { prompt: "Opening height", questionType: "text" },
            { prompt: "Header height", questionType: "text" },
            { prompt: "Approximate wall thickness", questionType: "text" },
          ],
        },
        {
          title: "Garage Door Opening — Condition",
          guideNotes: notes(
            "Inspect:",
            "Header",
            "Jambs",
            "Framing",
            "Sheathing",
            "Exterior finish",
            "Interior framing",
            "Determine whether the opening could potentially be reused or modified as part of the ADU design.",
            "RED FLAGS: large opening, damaged header, significant wall removal, proposed relocation, new large windows or doors.",
            "New or modified openings can create additional structural and shear requirements.",
          ),
        },
      ],
    },
    {
      title: "EXISTING WINDOWS & DOORS",
      items: [
        {
          title: "Existing Openings Inventory",
          guideNotes: notes(
            "Document every existing opening. For each opening, record:",
            "Location",
            "Width",
            "Height",
            "Distance to nearby property line, if relevant",
            "Existing header",
            "Exterior finish",
            "Interior finish",
            "PREFERRED APPROACH: Where practical, design around existing openings rather than creating unnecessary new openings. This can reduce structural work, engineering, shear modifications, exterior finish repair, and waterproofing work.",
          ),
        },
      ],
    },
    {
      title: "ROOF & EAVES",
      items: [
        {
          title: "Roof & Framing Condition",
          guideNotes: notes(
            "Inspect the roof from the exterior and attic, if accessible. Look for:",
            "Roof framing condition",
            "Sagging",
            "Rot",
            "Water damage",
            "Roof penetrations",
            "Previous modifications",
            "Eave projections",
            "Overhangs",
            "Skylights",
          ),
        },
        {
          title: "Eaves & Property Line Review",
          guideNotes: notes(
            "Pay particular attention to eaves and roof projections near property lines.",
            "RED FLAGS: eave crossing or approaching setback, damaged roof framing, existing water intrusion, unusual roof framing, existing roof modifications.",
            "PHOTOS: Photograph all conditions requiring Design or Engineering review.",
          ),
        },
      ],
    },
    {
      title: "PROPERTY LINE & FIRE CONDITIONS",
      items: [
        {
          title: "Property Line Conditions",
          guideNotes: notes(
            "Review the survey before the inspection and verify site conditions in the field. Look for:",
            "Garage walls close to property lines",
            "Eaves close to property lines",
            "Windows near property lines",
            "Doors near property lines",
            "Adjacent structures",
            "Fences",
            "Narrow setbacks",
            "DO NOT ASSUME: Do not tell the customer that a wall, window, eave, or other condition will or will not require fire-rated construction. Document the condition and flag it for Design/code review.",
          ),
          subQuestions: [
            {
              prompt: "Property line conditions present",
              questionType: "multi_select",
              options: [
                { label: "Garage wall close to property line" },
                { label: "Eave close to property line" },
                { label: "Window near property line" },
                { label: "Door near property line" },
                { label: "Narrow setback" },
                { label: "None" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "ELECTRICAL",
      items: [
        {
          title: "Electrical Service & Panel",
          guideNotes: notes(
            "PHOTOS: Locate and photograph the main electrical panel, garage panel, subpanels, and electrical meter.",
          ),
          subQuestions: [
            { prompt: "Panel manufacturer", questionType: "text" },
            { prompt: "Main breaker size", questionType: "text" },
            { prompt: "Approximate breaker space available", questionType: "text" },
          ],
        },
        {
          title: "Existing Garage Electrical",
          guideNotes: notes(
            "Locate and photograph:",
            "Existing garage circuits",
            "EV charger",
            "Hot tub or other large loads",
            "Record the existing garage electrical configuration in the notes.",
          ),
        },
        {
          title: "Electrical Red Flags",
          guideNotes: notes(
            "Document the condition. Final electrical capacity must be determined through the appropriate electrical/design review.",
          ),
          subQuestions: [
            {
              prompt: "Electrical red flags present",
              questionType: "multi_select",
              options: [
                { label: "60A service" },
                { label: "FPE panel" },
                { label: "Zinsco panel" },
                { label: "Overcrowded panel" },
                { label: "Limited breaker space" },
                { label: "Evidence of unpermitted modifications" },
                { label: "Service may not support proposed loads" },
                { label: "None" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "SEWER",
      items: [
        {
          title: "Sewer Connection & Cleanout",
          guideNotes: notes(
            "Locate the nearest known sewer connection or cleanout. Document:",
            "Cleanout location",
            "Approximate distance to garage",
            "Existing plumbing locations",
            "Direction of sewer line, if known",
            "Potential connection point",
            "Elevation concerns",
            "Potential trench route",
            "PHOTOS: Photograph every visible sewer cleanout and connection point.",
          ),
          subQuestions: [{ prompt: "Approximate distance to garage", questionType: "text" }],
        },
        {
          title: "Sewer Routing Concerns",
          guideNotes: notes(
            "Look for: long sewer runs, deep trenching, concrete removal, significant elevation changes, potential need for a sewage ejector.",
            "PREFERRED STRATEGY: Maintain a gravity-fed sewer connection whenever practical.",
          ),
          subQuestions: [
            {
              prompt: "Is a gravity-fed sewer connection practical?",
              questionType: "yes_no_na",
            },
          ],
        },
      ],
    },
    {
      title: "WATER",
      items: [
        {
          title: "Water Service & Connection Point",
          guideNotes: notes(
            "Locate: water meter, main water line, hose bibs, existing water service, potential ADU connection point.",
            "Document: connection location, approximate distance to garage, potential trench route.",
          ),
          subQuestions: [{ prompt: "Approximate distance to garage", questionType: "text" }],
        },
      ],
    },
    {
      title: "GAS",
      items: [
        {
          title: "Gas Service & Connection Route",
          guideNotes: notes(
            "Locate: gas meter, existing gas lines, gas appliances, potential connection route.",
            "Document the location even if gas is not currently planned for the ADU.",
          ),
        },
      ],
    },
    {
      title: "PLUMBING LAYOUT",
      items: [
        {
          title: "Existing Plumbing Relative to Proposed ADU",
          guideNotes: notes(
            "Identify where existing plumbing is located relative to the proposed ADU. Pay particular attention to the relationship between kitchen, bathroom, laundry, sewer, water, and gas.",
            "PREFERRED STRATEGY: Keep kitchen, bathroom, and laundry areas close to existing utility connections whenever practical.",
            "RED FLAGS: long plumbing runs, deep trenching, concrete cutting, significant elevation changes, pump requirements.",
            "The PM should provide this information to Design before the final floor plan is developed.",
          ),
        },
      ],
    },
    {
      title: "MOISTURE & WATER INTRUSION",
      items: [
        {
          title: "Moisture & Water Intrusion",
          guideNotes: notes(
            "Inspect for:",
            "Water stains",
            "Dampness",
            "Efflorescence",
            "Mold",
            "Rot",
            "Wall staining",
            "Moisture at slab edges",
            "Exterior drainage problems",
            "Previous repairs",
            "PHOTOS: Photograph all evidence of moisture or water intrusion.",
            "GARAGE SLAB: Garage slabs may not have the same moisture-control assembly as habitable space. Flag existing slabs with potential moisture concerns for Design/Estimating review.",
          ),
        },
      ],
    },
    {
      title: "INSULATION & ENERGY CONDITIONS",
      items: [
        {
          title: "Existing Insulation & Assemblies",
          guideNotes: notes(
            "Inspect any visible wall insulation, ceiling insulation, roof insulation, existing vapor barriers, and wall assemblies.",
            "IMPORTANT: Do not assume existing insulation or assemblies meet current ADU energy requirements. Document what is visible and allow Design to determine the required Title 24 assembly.",
          ),
        },
      ],
    },
    {
      title: "DRAINAGE & SITE GRADING",
      items: [
        {
          title: "Drainage & Grading",
          guideNotes: notes(
            "Walk the area surrounding the garage. Look for:",
            "Water flowing toward the garage",
            "Low spots",
            "Standing water",
            "Downspouts",
            "Poor drainage",
            "Retaining walls",
            "Steep slopes",
            "Grade changes",
            "PHOTOS: Photograph existing drainage, downspouts, low areas, retaining walls, and grade transitions.",
            "Flag conditions that could affect the ADU foundation, slab, waterproofing, or site work.",
          ),
        },
      ],
    },
    {
      title: "LANDSCAPING & TREES",
      items: [
        {
          title: "Landscaping, Trees & Hardscape",
          guideNotes: notes(
            "Document anything that could be affected by construction. Look for:",
            "Trees",
            "Large roots",
            "Stumps",
            "Irrigation",
            "Planting",
            "Decorative fencing",
            "Hardscape",
            "Patios",
            "Walkways",
            "PM STANDARD: Identify and document items that need to be protected, removed, or relocated.",
            "Do not automatically include landscaping replacement or decorative restoration in the construction scope.",
          ),
        },
      ],
    },
    {
      title: "DEMOLITION & ABATEMENT",
      items: [
        {
          title: "Demolition & Hazardous Material Concerns",
          guideNotes: notes(
            "Inspect the garage for potential demolition concerns. Look for:",
            "Old building materials",
            "Damaged materials",
            "Suspected asbestos-containing materials",
            "Lead paint concerns",
            "Buried debris",
            "Thick concrete",
            "Unknown utilities",
            "Previous additions",
            "Unpermitted modifications",
            "IMPORTANT: Do not assume hazardous materials are absent simply because they are not visible. Document concerns and escalate them for appropriate review.",
          ),
          subQuestions: [
            {
              prompt: "Suspected hazardous materials observed?",
              questionType: "yes_no_na",
            },
          ],
        },
      ],
    },
    {
      title: "FLOOR PLAN / COST-SAVING REVIEW",
      items: [
        {
          title: "Reuse Opportunities",
          guideNotes: notes(
            "Before leaving the property, review the proposed layout against the existing structure. Look for opportunities to keep:",
            "Existing footprint",
            "Existing windows",
            "Existing doors",
            "Existing headers",
            "Existing utility routes",
            "Existing sewer connections",
            "Existing structural elements",
          ),
        },
        {
          title: "Avoid Unnecessary Scope",
          guideNotes: notes(
            "Avoid:",
            "Expanding the footprint unnecessarily",
            "Moving existing openings unnecessarily",
            "Long utility runs",
            "Complex sewer routing",
            "Pumps",
            "Unnecessary slab removal",
            "Exterior shear modifications",
            "Unnecessary exterior finish demolition",
          ),
        },
      ],
    },
    {
      title: "REQUIRED PHOTOGRAPHS",
      items: [
        {
          title: "Exterior Photos",
          guideNotes: notes(
            "Before leaving the property, confirm you have photos of:",
            "Front of property",
            "Garage from street",
            "Garage from driveway",
            "Each side of garage",
            "Rear of garage",
            "Roof",
            "Eaves",
            "Garage door",
            "Windows",
            "Doors",
            "Property-line conditions",
            "Adjacent structures",
            "Utilities",
            "Drainage",
            "Retaining walls",
            "Trees",
            "Landscaping",
          ),
        },
        {
          title: "Interior Photos",
          guideNotes: notes(
            "Confirm you have photos of:",
            "Overall garage",
            "Each wall",
            "Floor",
            "Ceiling",
            "Roof framing",
            "Garage door opening",
            "Windows",
            "Doors",
            "Electrical panel",
            "Plumbing",
            "Sewer",
            "Water",
            "Gas",
            "HVAC",
            "Water heater",
            "Moisture/damage",
            "Any unusual conditions",
          ),
        },
        {
          title: "Access Photos",
          guideNotes: notes(
            "Confirm you have photos of:",
            "Driveway",
            "Gates",
            "Side yards",
            "Equipment access",
            "Material delivery route",
            "Staging area",
            "Dumpster location",
          ),
        },
      ],
    },
    {
      title: "RED FLAG REVIEW BEFORE LEAVING",
      items: [
        {
          title: "Structure Red Flags",
          guideNotes: notes("Before leaving the property, review the following."),
          subQuestions: [
            {
              prompt: "Structure red flags",
              questionType: "multi_select",
              options: [
                { label: "Footing condition unknown" },
                { label: "Slab cracking/settlement" },
                { label: "Wall damage" },
                { label: "Roof damage" },
                { label: "Rot/termite concerns" },
                { label: "Structural modifications" },
                { label: "Large openings" },
                { label: "None" },
              ],
            },
          ],
        },
        {
          title: "Utilities Red Flags",
          guideNotes: notes("Review utility conditions before leaving."),
          subQuestions: [
            {
              prompt: "Utilities red flags",
              questionType: "multi_select",
              options: [
                { label: "Sewer location unknown" },
                { label: "Long sewer run" },
                { label: "Significant elevation issue" },
                { label: "Electrical capacity concern" },
                { label: "FPE/Zinsco panel" },
                { label: "Difficult utility routing" },
                { label: "None" },
              ],
            },
          ],
        },
        {
          title: "Site Red Flags",
          guideNotes: notes("Review site conditions before leaving."),
          subQuestions: [
            {
              prompt: "Site red flags",
              questionType: "multi_select",
              options: [
                { label: "Limited access" },
                { label: "Equipment restrictions" },
                { label: "Difficult excavation" },
                { label: "Retaining wall" },
                { label: "Drainage concern" },
                { label: "Significant grade change" },
                { label: "Trees/root concerns" },
                { label: "None" },
              ],
            },
          ],
        },
        {
          title: "Code / Design Red Flags",
          guideNotes: notes("Review code and design conditions before leaving."),
          subQuestions: [
            {
              prompt: "Code / design red flags",
              questionType: "multi_select",
              options: [
                { label: "Garage close to property line" },
                { label: "Eaves near property line" },
                { label: "Openings near property line" },
                { label: "Attached garage" },
                { label: "Existing nonconforming conditions" },
                { label: "Fire separation concern" },
                { label: "None" },
              ],
            },
          ],
        },
        {
          title: "Existing Conditions Red Flags",
          guideNotes: notes("Review existing conditions before leaving."),
          subQuestions: [
            {
              prompt: "Existing conditions red flags",
              questionType: "multi_select",
              options: [
                { label: "Water intrusion" },
                { label: "Moisture concern" },
                { label: "Potential hazardous materials" },
                { label: "Buried debris" },
                { label: "Previous unpermitted work" },
                { label: "None" },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "POST-INSPECTION",
      items: [
        {
          title: "Complete Field Notes",
          guideNotes: notes(
            "Immediately after the inspection, record:",
            "Measurements",
            "Existing conditions",
            "Utility locations",
            "Access conditions",
            "Customer concerns",
            "Potential cost drivers",
          ),
        },
        {
          title: "Identify Unknowns",
          guideNotes: notes(
            "Clearly identify anything that could not be verified during the inspection. Examples:",
            "Footing depth",
            "Sewer location",
            "Electrical capacity",
            "Existing structural assembly",
            "Concealed damage",
            "Roof framing",
            "Drainage conditions",
          ),
        },
        {
          title: "Flag Issues for Review",
          guideNotes: notes(
            "Notify the appropriate team when additional review is required. Potential reviewers include Design, Estimating, Production, Engineering, and Management.",
            "DO NOT LEAVE CRITICAL CONDITIONS UNREPORTED: if a condition could materially affect cost, schedule, design, permitting, construction, or customer expectations, it should be documented and communicated before the project progresses.",
          ),
          subQuestions: [
            {
              prompt: "Teams to notify",
              questionType: "multi_select",
              options: [
                { label: "Design" },
                { label: "Estimating" },
                { label: "Production" },
                { label: "Engineering" },
                { label: "Management" },
                { label: "None required" },
              ],
            },
          ],
        },
      ],
    },
  ],
};
