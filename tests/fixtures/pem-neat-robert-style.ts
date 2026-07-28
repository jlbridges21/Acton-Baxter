/**
 * Synthetic PEM transcript modeled on long real PEMs (no real customer PII).
 * Includes beginning PALO, middle pain/budget/decision/project, end next steps.
 */
export const ROBERT_STYLE_PEM_TRANSCRIPT = `
Advisor Jesse: Thanks for meeting today. The purpose of this Partnership Evaluation Meeting is to understand what you're trying to accomplish with an ADU, talk through budget and decision process, and see whether Acton is the right partner. We'll cover your goals, site considerations, and then agree on a clear next step. Does that agenda work?
Prospect Robert: Yes, that works.

Advisor Jesse: Tell me what's driving the project.
Prospect Robert: We looked at one of your Build Ready models online — the one around 500 square feet. We're trying to create a private living space on the property so my parent can live nearby without everyone being on top of each other. Independence matters. Right now the house is cramped and separate rent is expensive.

Advisor Jesse: So the ADU would support your parent and maybe guests later?
Prospect Robert: Exactly. Also future caregiver flexibility if we need it. We don't want to rush, but we'd like to start this year if the numbers make sense.

Advisor Jesse: Any prior builder experiences that shape what you're looking for?
Prospect Robert: We talked to another contractor who stopped communicating mid-process and surprise costs kept popping up. Transparency and one responsible party matter a lot. We don't want to hire a separate architect and then a builder who points fingers.

Advisor Jesse: That helps. Let's talk budget. Where are you hoping to land?
Prospect Robert: I'd love to stay under $250,000, but based on what I've heard it might be closer to $300,000. Could we do less square footage but make it custom — is there a big difference versus Build Ready?
Advisor Jesse: Custom can change cost and timeline. Build Ready gives a clearer starting point; custom adds design flexibility. We'd need a feasibility look at utilities before locking a number.
Prospect Robert: That makes sense. Funding would probably be a mix of cash and a loan. Another builder verbally said around $280,000 for something similar.

Advisor Jesse: Who else is involved in the decision?
Prospect Robert: My spouse and I decide together. Spouse couldn't join today. We're also comparing two other design-build companies. Criteria: communication, competence, budget clarity, and gut feel. No hard decision date yet — maybe reconnect in two weeks after we talk.

Advisor Jesse: Site questions — anything about sewer or utilities?
Prospect Robert: Yes — what's the sewer situation for a detached unit? Also electrical capacity and water. The lot has a slope on the north side.
Advisor Jesse: Those are exactly the kinds of things we'd inspect in feasibility before full design.

Advisor Jesse: Based on what you've shared, Acton's feasibility-first process fits a project with utility unknowns and a desire for transparent risk management. Next step I'd recommend is a tailored feasibility agreement so we can evaluate the site and give a clearer path.
Prospect Robert: Please send that. We'll review with my spouse and reconnect.
Advisor Jesse: I'll email the agreement tomorrow and call you Friday to schedule a follow-up Zoom. Sound good?
Prospect Robert: Yes — email is best for documents, and call Friday works.
Advisor Jesse: Great. Thanks for your time today.
`.repeat(2);

export const EXPECTED_ROBERT_STYLE_CONCEPTS = {
  storyHints: [/parent/i, /independen/i, /Build Ready|square feet|500/i],
  type1Hints: [/private|independen|parent|caregiver|rent/i],
  type2Hints: [/communicat|transpar|surpris|architect|finger|coordinat/i],
  budgetHints: [/250|300|280|explorat|cash|loan/i],
  decisionHints: [/spouse|compar|two weeks|design-build/i],
  projectHints: [/sewer|electrical|water|slope|Build Ready|square/i],
  nextStepHints: [/feasibility|email|Friday|Zoom|spouse/i],
};
