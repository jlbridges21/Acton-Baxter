import "server-only";

import { isGhlConfigured } from "@/lib/connectors/ghl/config";
import {
  findContactByEmail,
  findContactByPhone,
  findContactsFuzzy,
} from "@/lib/connectors/ghl/resources/contacts";
import {
  listOpportunitiesByContact,
  searchOpportunities,
} from "@/lib/connectors/ghl/resources/opportunities";
import { listPipelines, findPipelineByName } from "@/lib/connectors/ghl/resources/pipelines";
import { findTagByName } from "@/lib/connectors/ghl/resources/tags";
import { getCustomFieldByKey } from "@/lib/connectors/ghl/resources/custom-fields";
import type { GhlContact, GhlOpportunity, GhlPipeline } from "@/lib/connectors/ghl/types";
import { normalizeGhlQuestionText, stripContactNamePossessive } from "@/lib/baxter-ai/ghl-intent";

export type EntityResolutionResult<T> = {
  resolved: boolean;
  entity?: T;
  candidates?: T[];
  ambiguous: boolean;
  ambiguityMessage?: string;
  notFound: boolean;
  /** Safe diagnostics (ids/counts only). */
  diagnostics?: {
    searchAttempted: boolean;
    matchCount: number;
    selectedContactId: string | null;
    selectionReason: string | null;
  };
};

/**
 * Resolve a contact by name, email, or phone.
 * Returns ambiguity list if multiple matches found - never guesses.
 */
export async function resolveContact(input: {
  name?: string;
  email?: string;
  phone?: string;
}): Promise<EntityResolutionResult<GhlContact>> {
  if (!isGhlConfigured()) {
    return { resolved: false, ambiguous: false, notFound: true };
  }

  try {
    // Try exact email match first
    if (input.email) {
      const contact = await findContactByEmail(input.email);
      if (contact) {
        return {
          resolved: true,
          entity: contact,
          ambiguous: false,
          notFound: false,
          diagnostics: {
            searchAttempted: true,
            matchCount: 1,
            selectedContactId: contact.id,
            selectionReason: "email_exact",
          },
        };
      }
    }

    // Try exact phone match
    if (input.phone) {
      const contact = await findContactByPhone(input.phone);
      if (contact) {
        return {
          resolved: true,
          entity: contact,
          ambiguous: false,
          notFound: false,
          diagnostics: {
            searchAttempted: true,
            matchCount: 1,
            selectedContactId: contact.id,
            selectionReason: "phone_exact",
          },
        };
      }
    }

    // Try name search (may be ambiguous)
    if (input.name) {
      const cleanedName = stripContactNamePossessive(normalizeGhlQuestionText(input.name));
      const matches = await findContactsFuzzy(cleanedName, { limit: 8 });
      const contacts = matches.map((m) => m.contact);

      if (contacts.length === 0) {
        return {
          resolved: false,
          ambiguous: false,
          notFound: true,
          diagnostics: {
            searchAttempted: true,
            matchCount: 0,
            selectedContactId: null,
            selectionReason: null,
          },
        };
      }

      if (contacts.length === 1) {
        return {
          resolved: true,
          entity: contacts[0],
          ambiguous: false,
          notFound: false,
          diagnostics: {
            searchAttempted: true,
            matchCount: 1,
            selectedContactId: contacts[0]!.id,
            selectionReason: "unique_match",
          },
        };
      }

      // Prefer a single clear exact-name (or first+last exact) hit over ambiguous near-matches.
      const exactName = matches.filter(
        (m) =>
          m.matchedOn.includes("name_exact") ||
          (m.matchedOn.includes("firstName_exact") && m.matchedOn.includes("lastName_exact")),
      );
      if (exactName.length === 1) {
        return {
          resolved: true,
          entity: exactName[0]!.contact,
          ambiguous: false,
          notFound: false,
          diagnostics: {
            searchAttempted: true,
            matchCount: matches.length,
            selectedContactId: exactName[0]!.contact.id,
            selectionReason: "unique_exact_among_many",
          },
        };
      }

      const highOnly = matches.filter((m) => m.confidence === "high");
      if (highOnly.length === 1) {
        return {
          resolved: true,
          entity: highOnly[0]!.contact,
          ambiguous: false,
          notFound: false,
          diagnostics: {
            searchAttempted: true,
            matchCount: matches.length,
            selectedContactId: highOnly[0]!.contact.id,
            selectionReason: "unique_high_confidence",
          },
        };
      }

      // Multiple matches - return ambiguity
      return {
        resolved: false,
        candidates: contacts,
        ambiguous: true,
        ambiguityMessage: formatContactAmbiguity(contacts),
        notFound: false,
        diagnostics: {
          searchAttempted: true,
          matchCount: matches.length,
          selectedContactId: null,
          selectionReason: "ambiguous",
        },
      };
    }

    return { resolved: false, ambiguous: false, notFound: true };
  } catch (error) {
    console.error("Contact resolution failed:", error);
    return { resolved: false, ambiguous: false, notFound: true };
  }
}

/**
 * Resolve an opportunity by name or contact association.
 */
export async function resolveOpportunity(input: {
  opportunityName?: string;
  contactName?: string;
  contactId?: string;
  pipelineId?: string;
}): Promise<EntityResolutionResult<GhlOpportunity>> {
  if (!isGhlConfigured()) {
    return { resolved: false, ambiguous: false, notFound: true };
  }

  try {
    // If we have a contact ID, get their opportunities
    if (input.contactId) {
      const opportunities = await listOpportunitiesByContact(input.contactId);

      if (opportunities.length === 0) {
        return { resolved: false, ambiguous: false, notFound: true };
      }

      if (opportunities.length === 1) {
        return { resolved: true, entity: opportunities[0], ambiguous: false, notFound: false };
      }

      // Filter by name if provided
      if (input.opportunityName) {
        const nameMatches = opportunities.filter((o: GhlOpportunity) =>
          o.name?.toLowerCase().includes(input.opportunityName!.toLowerCase()),
        );
        if (nameMatches.length === 1) {
          return { resolved: true, entity: nameMatches[0], ambiguous: false, notFound: false };
        }
        if (nameMatches.length > 1) {
          return {
            resolved: false,
            candidates: nameMatches,
            ambiguous: true,
            ambiguityMessage: formatOpportunityAmbiguity(nameMatches),
            notFound: false,
          };
        }
      }

      // Multiple opportunities for contact
      return {
        resolved: false,
        candidates: opportunities,
        ambiguous: true,
        ambiguityMessage: formatOpportunityAmbiguity(opportunities),
        notFound: false,
      };
    }

    // Search by opportunity name
    if (input.opportunityName) {
      // searchOpportunities doesn't support text search, so we get all open and filter
      const result = await searchOpportunities({
        status: "all",
        limit: 50,
      });

      const matches = result.opportunities.filter((o: GhlOpportunity) =>
        o.name?.toLowerCase().includes(input.opportunityName!.toLowerCase()),
      );

      if (matches.length === 0) {
        return { resolved: false, ambiguous: false, notFound: true };
      }

      if (matches.length === 1) {
        return { resolved: true, entity: matches[0], ambiguous: false, notFound: false };
      }

      return {
        resolved: false,
        candidates: matches,
        ambiguous: true,
        ambiguityMessage: formatOpportunityAmbiguity(matches),
        notFound: false,
      };
    }

    // If we have contact name, resolve contact first
    if (input.contactName) {
      const contactResult = await resolveContact({ name: input.contactName });
      if (contactResult.resolved && contactResult.entity) {
        return resolveOpportunity({
          ...input,
          contactId: contactResult.entity.id,
          contactName: undefined,
        });
      }
      if (contactResult.ambiguous) {
        return {
          resolved: false,
          ambiguous: true,
          ambiguityMessage: `Multiple contacts match "${input.contactName}". Please be more specific: ${contactResult.ambiguityMessage}`,
          notFound: false,
        };
      }
    }

    return { resolved: false, ambiguous: false, notFound: true };
  } catch (error) {
    console.error("Opportunity resolution failed:", error);
    return { resolved: false, ambiguous: false, notFound: true };
  }
}

/**
 * Resolve a pipeline stage by name.
 */
export async function resolvePipelineStage(input: {
  pipelineName?: string;
  stageName: string;
}): Promise<{
  resolved: boolean;
  pipeline?: GhlPipeline;
  stageId?: string;
  stageName?: string;
  ambiguous: boolean;
  ambiguityMessage?: string;
}> {
  if (!isGhlConfigured()) {
    return { resolved: false, ambiguous: false };
  }

  try {
    let pipeline: GhlPipeline | null = null;

    if (input.pipelineName) {
      pipeline = await findPipelineByName(input.pipelineName);
    } else {
      // Get the first/default pipeline
      const pipelines = await listPipelines();
      pipeline = pipelines[0] || null;
    }

    if (!pipeline) {
      return { resolved: false, ambiguous: false };
    }

    type PipelineStage = { id: string; name?: string };
    const stages = (pipeline.stages || []) as PipelineStage[];
    const lowerStageName = input.stageName.toLowerCase();

    // Exact match first
    const exactMatch = stages.find((s: PipelineStage) => s.name?.toLowerCase() === lowerStageName);
    if (exactMatch) {
      return {
        resolved: true,
        pipeline,
        stageId: exactMatch.id,
        stageName: exactMatch.name,
        ambiguous: false,
      };
    }

    // Partial match
    const partialMatches = stages.filter((s: PipelineStage) =>
      s.name?.toLowerCase().includes(lowerStageName),
    );

    if (partialMatches.length === 1) {
      return {
        resolved: true,
        pipeline,
        stageId: partialMatches[0]!.id,
        stageName: partialMatches[0]!.name,
        ambiguous: false,
      };
    }

    if (partialMatches.length > 1) {
      return {
        resolved: false,
        pipeline,
        ambiguous: true,
        ambiguityMessage: `Multiple stages match "${input.stageName}": ${partialMatches.map((s: PipelineStage) => s.name).join(", ")}`,
      };
    }

    return {
      resolved: false,
      pipeline,
      ambiguous: false,
      ambiguityMessage: `Stage "${input.stageName}" not found. Available stages: ${stages.map((s: PipelineStage) => s.name).join(", ")}`,
    };
  } catch (error) {
    console.error("Pipeline stage resolution failed:", error);
    return { resolved: false, ambiguous: false };
  }
}

/**
 * Resolve a tag by name.
 */
export async function resolveTag(
  tagName: string,
): Promise<{ resolved: boolean; tagId?: string; tagName?: string }> {
  if (!isGhlConfigured()) {
    return { resolved: false };
  }

  try {
    const tag = await findTagByName(tagName);
    if (tag) {
      return { resolved: true, tagId: tag.id, tagName: tag.name };
    }
    return { resolved: false };
  } catch (error) {
    console.error("Tag resolution failed:", error);
    return { resolved: false };
  }
}

/**
 * Resolve a custom field by name.
 */
export async function resolveCustomField(
  fieldName: string,
): Promise<{ resolved: boolean; fieldId?: string; fieldKey?: string; fieldName?: string }> {
  if (!isGhlConfigured()) {
    return { resolved: false };
  }

  try {
    const field = await getCustomFieldByKey(fieldName);
    if (field) {
      return {
        resolved: true,
        fieldId: field.id,
        fieldKey: field.fieldKey,
        fieldName: field.name,
      };
    }
    return { resolved: false };
  } catch (error) {
    console.error("Custom field resolution failed:", error);
    return { resolved: false };
  }
}

function formatContactAmbiguity(contacts: GhlContact[]): string {
  return contacts
    .map((c) => {
      const parts = [c.name || `${c.firstName} ${c.lastName}`.trim()];
      if (c.email) parts.push(c.email);
      if (c.companyName) parts.push(`(${c.companyName})`);
      return parts.join(" - ");
    })
    .join("; ");
}

function formatOpportunityAmbiguity(opportunities: GhlOpportunity[]): string {
  return opportunities
    .map((o) => {
      const parts = [o.name || "Unnamed opportunity"];
      if (o.monetaryValue) parts.push(`$${o.monetaryValue.toLocaleString()}`);
      if (o.status) parts.push(`(${o.status})`);
      return parts.join(" - ");
    })
    .join("; ");
}
