/**
 * Canonical Detached ADU checklist seed — inserted as editable DB rows, not UI constants.
 */

import type { SeedTemplateInput } from "./types";

function notes(...bullets: string[]): string {
  return bullets.map((b) => `• ${b}`).join("\n");
}

export const DETACHED_ADU_TEMPLATE_NAME = "Detached ADU";

export const DETACHED_ADU_SEED: SeedTemplateInput = {
  name: DETACHED_ADU_TEMPLATE_NAME,
  description: "Standard site inspection checklist for detached ADU projects.",
  standaloneItems: [
    {
      title: "Front Photo of Main House",
      guideNotes: notes(
        "Capture a clear front elevation of the main house for the inspection cover.",
      ),
      isCoverPhotoSource: true,
    },
  ],
  sections: [
    {
      title: "SITE OVERVIEW & PROPERTY CHARACTERISTICS",
      items: [
        {
          title: "General Site Conditions",
          guideNotes: notes(
            "Neighborhood characteristics (traffic, schools, apartments/commercial nearby)",
            "Onsite parking availability",
            "Street parking restrictions or permit requirements",
          ),
          subQuestions: [{ prompt: "Are there parking restrictions?", questionType: "yes_no_na" }],
        },
        {
          title: "Topography",
          guideNotes: notes("Flat or sloped lot", "Approximate elevation change across property"),
          subQuestions: [
            {
              prompt: "Lot",
              questionType: "single_select",
              options: [{ label: "Flat" }, { label: "Sloped" }],
            },
          ],
        },
        {
          title: "Landscape & Hardscape",
          guideNotes: notes(
            "Existing hardscape (driveways, walkways, patios, pools, decorative features)",
            "Existing landscape (lawn, gardens, hedges, trees, stumps)",
            'Trees over 12" diameter — approximate diameter, canopy impact on build area',
          ),
          subQuestions: [
            { prompt: "Tree removal needed?", questionType: "yes_no_na" },
            { prompt: "Quantity and size", questionType: "text" },
          ],
        },
        {
          title: "Access",
          guideNotes: notes(
            "Access route to proposed ADU location",
            "Construction obstacles or restrictions",
            "Minimum access width (gates, walkways, side yards)",
          ),
          subQuestions: [
            {
              prompt: "Is there sufficient access to proposed ADU location?",
              questionType: "yes_no_na",
            },
            {
              prompt: "Are there any access restrictions or barriers?",
              questionType: "yes_no_na",
            },
            { prompt: "If so, please describe", questionType: "text" },
          ],
        },
      ],
    },
    {
      title: "MAIN HOUSE",
      items: [
        {
          title: "Foundation Type",
          guideNotes: notes("Foundation type (crawlspace, slab-on-grade, basement)"),
          subQuestions: [
            {
              prompt: "Main home foundation type",
              questionType: "single_select",
              options: [{ label: "Slab-on-grade" }, { label: "Crawlspace" }, { label: "Basement" }],
            },
            { prompt: "Main home eave projection", questionType: "text" },
          ],
        },
        {
          title: "Finish Details",
          guideNotes: notes(
            "Exterior finishes",
            "Wall and trim details",
            "Window and door characteristics",
            "Roofing material and condition",
            "Eaves, gutters, and downspouts",
            "Depth of eaves near proposed ADU location",
            "Wall heights",
            "Roof pitch",
            "Architectural details or unique design features",
          ),
        },
      ],
    },
    {
      title: "PROPOSED ADU AREA",
      items: [
        {
          title: "Proposed ADU Area",
          guideNotes: notes(
            "Confirm proposed ADU location",
            "Distances to side property lines, rear property line, existing structures",
          ),
          subQuestions: [{ prompt: "Demo required in ADU location?", questionType: "yes_no_na" }],
        },
        {
          title: "Construction Staging and Material Storage",
          guideNotes: notes("Suitable locations for on-site storage"),
        },
        {
          title: "Accessory Structures",
          guideNotes: notes(
            "Garage, shed, pergola, play structures",
            "Approximate dimensions",
            "Location relative to property lines, main house, proposed ADU",
          ),
        },
      ],
    },
    {
      title: "TRENCH",
      items: [
        {
          title: "Recommended Trench Route",
          guideNotes: notes("Electrical, water, sewer", "Potential conflicts or obstacles"),
          subQuestions: [
            {
              prompt: "Surface type",
              questionType: "multi_select",
              options: [{ label: "Grass" }, { label: "Concrete" }, { label: "Pavers" }],
            },
          ],
        },
      ],
    },
    {
      title: "ELECTRICAL",
      items: [
        {
          title: "Existing Service",
          guideNotes: notes(
            "Main electrical panel location",
            "Electrical service type (overhead, underground)",
            "Power source route",
            "Obstacles/interference affecting utility access",
            "Panel accessibility",
          ),
          subQuestions: [
            {
              prompt: "Service type",
              questionType: "single_select",
              options: [{ label: "Overhead" }, { label: "Underground" }],
            },
            {
              prompt: "Main panel size",
              questionType: "single_select",
              options: [{ label: "100" }, { label: "200" }, { label: "320" }, { label: "400" }],
            },
            { prompt: "Relocate existing panel?", questionType: "yes_no_na" },
          ],
        },
        {
          title: "Documentation Required",
          guideNotes: notes(
            "Main panel photos",
            "Electrical meter photos",
            "Legible serial numbers",
            "Breaker labeling and amperages",
            "Panel specification stickers",
            "Utility drop path to power pole or underground vault",
          ),
        },
        {
          title: "Additional Electrical Notes",
          guideNotes: notes(
            "Solar panel quantity and location",
            "EV chargers or future electrical loads",
            "Existing subpanels",
          ),
        },
      ],
    },
    {
      title: "WATER",
      items: [
        {
          title: "Existing Service",
          guideNotes: notes(
            "Water meter location",
            "Main shutoff location",
            "Approximate water line route",
            "Pipe sizes if visible/known",
          ),
          subQuestions: [
            {
              prompt: "Water line size",
              questionType: "single_select",
              options: [
                { label: '5/8"' },
                { label: '3/4"' },
                { label: '1"' },
                { label: '1-1/4"' },
                { label: '1-1/2"' },
                { label: '2"' },
              ],
            },
            {
              prompt: "Water meter size",
              questionType: "single_select",
              options: [
                { label: '5/8"' },
                { label: '3/4"' },
                { label: '1"' },
                { label: '1-1/2"' },
                { label: '2"' },
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
          title: "Sewer",
          guideNotes: notes(
            "Sewer cleanout locations",
            "Approximate sewer line route",
            "Sewer depths at multiple points",
            "Pipe material",
            "Pipe size",
            "Existing condition",
            "Camera inspection information from plumber",
          ),
          subQuestions: [
            { prompt: "New property line cleanout needed?", questionType: "yes_no_na" },
            { prompt: "Lift pump needed?", questionType: "yes_no_na" },
          ],
        },
      ],
    },
    {
      title: "GAS",
      items: [
        {
          title: "Gas",
          guideNotes: notes("Gas meter location"),
          subQuestions: [
            {
              prompt: "Does the gas meter location interfere with other utilities?",
              questionType: "yes_no_na",
            },
          ],
        },
      ],
    },
    {
      title: "HYDRANT / FIRE SPRINKLERS",
      items: [
        {
          title: "Fire Hydrant",
          guideNotes: notes("Fire hydrant location"),
        },
        {
          title: "Existing Fire Sprinklers",
          guideNotes: notes("Supply location / riser location"),
        },
      ],
    },
    {
      title: "RED FLAGS / CONCERNS",
      items: [
        {
          title: "Site Risks",
          guideNotes: notes(
            "Unusual site characteristics",
            "Limited access",
            "Steep slopes",
            "Utility conflicts",
            "Large tree impacts",
            "Drainage concerns",
            "Neighbor proximity issues",
            "Easement conflicts",
          ),
        },
        {
          title: "General Notes",
          guideNotes: notes(
            "Additional concerns",
            "Recommended follow-up items",
            "Items requiring consultant review",
            "Jurisdiction-specific concerns",
          ),
        },
      ],
    },
  ],
};
