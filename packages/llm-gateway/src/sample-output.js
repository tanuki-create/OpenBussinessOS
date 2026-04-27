"use strict";

function stableHash(value) {
  const text = JSON.stringify(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function textFromRequest(input = {}) {
  if (input.oneLiner) return input.oneLiner;
  if (input.project && input.project.oneLiner) return input.project.oneLiner;
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    const lastUserMessage = input.messages.filter((message) => message.role === "user").pop();
    if (lastUserMessage && lastUserMessage.content) return lastUserMessage.content;
  }
  return "A focused business idea";
}

function sampleBusinessMap(input = {}) {
  const oneLiner = textFromRequest(input);
  const suffix = stableHash(oneLiner).slice(0, 6);

  return {
    concept: {
      title: `Business Map ${suffix}`,
      oneLiner,
      description: `Turn "${oneLiner}" into a narrow MVP with explicit users, assumptions, metrics, and a two-week validation loop.`,
      businessType: "b2b_saas"
    },
    targetUsers: [
      {
        name: "Early adopter operator",
        description: "A hands-on user who owns the painful workflow and can validate value quickly.",
        painPoints: [
          "The current workflow is slow to repeat",
          "Important context is scattered across tools"
        ],
        currentAlternatives: ["Spreadsheets", "Manual notes", "Generic task tools"]
      }
    ],
    idealState: {
      description: "The user can move from idea to a concrete validation plan in one short session.",
      horizon: "2 weeks",
      observableOutcomes: [
        "A reviewed business map exists",
        "Top assumptions are ranked",
        "Work items are ready for execution"
      ]
    },
    northStarMetric: {
      name: "Validated weekly learning loops",
      definition: "Count of completed idea-to-review loops that produced an explicit decision.",
      whyItMatters: "It measures whether the product helps users convert ambiguity into execution.",
      caveats: ["Do not optimize for activity without evidence", "Track quality of decisions separately"]
    },
    assumptions: [
      {
        statement: "Users will provide enough context from a one-line idea to start a useful plan.",
        type: "customer",
        riskLevel: "high",
        evidenceLevel: "none",
        validationMethod: "Run five assisted intake sessions and compare accepted drafts."
      },
      {
        statement: "A two-week timebox is short enough to drive action but long enough to learn.",
        type: "operations",
        riskLevel: "medium",
        evidenceLevel: "weak",
        validationMethod: "Review completion rate after the first three project loops."
      }
    ],
    risks: [
      {
        title: "Over-broad plan",
        description: "The generated plan may include too many parallel initiatives.",
        severity: "high",
        mitigation: "Limit MVP output to the top initiatives and require human approval."
      }
    ],
    nextQuestions: [
      {
        question: "Who is the first user segment that can test this within two weeks?",
        reason: "The plan needs one concrete audience before initiatives are useful.",
        inputType: "short_text"
      },
      {
        question: "What result would make this idea worth continuing?",
        reason: "Success criteria keep the loop tied to evidence.",
        inputType: "long_text"
      }
    ]
  };
}

function sampleInitiatives(input = {}) {
  const oneLiner = textFromRequest(input);

  return {
    initiatives: [
      {
        title: "Validate the first high-risk assumption",
        description: `Run a focused validation loop for "${oneLiner}" with one target user segment.`,
        initiativeType: "research",
        relatedAssumption: "Users will provide enough context from a one-line idea to start a useful plan.",
        relatedMetric: "Validated weekly learning loops",
        hypothesis: "If the intake and draft plan are narrow, users will approve or correct them in one session.",
        successCriteria: "At least three users can approve a business map and select one initiative.",
        timeboxDays: 14,
        priority: "high",
        workItems: [
          {
            title: "Create intake interview script",
            description: "Prepare a short script that captures target user, painful workflow, and success condition.",
            workType: "research",
            acceptanceCriteria: [
              "Script has no more than seven questions",
              "Questions map to assumptions and metrics"
            ],
            priority: "high"
          },
          {
            title: "Draft implementation task list",
            description: "Convert the approved initiative into small work items with acceptance criteria.",
            workType: "issue",
            acceptanceCriteria: [
              "Every task has a visible outcome",
              "No task depends on external integrations"
            ],
            priority: "medium"
          }
        ]
      }
    ]
  };
}

function sampleEngineeringState() {
  return {
    summary: "The current engineering state is suitable for a narrow MVP if scope stays focused on draft generation and approval.",
    currentCapabilities: [
      "Local API can call an LLM gateway",
      "Project state can store draft business primitives",
      "Manual approval can gate generated output"
    ],
    limitations: [
      {
        area: "operations",
        description: "External tool execution is not automated yet.",
        businessImpact: "Users need to export or approve drafts manually.",
        severity: "medium"
      },
      {
        area: "cost",
        description: "Token estimates are approximate until provider usage is reconciled.",
        businessImpact: "Budget meters should be shown as estimates.",
        severity: "low"
      }
    ],
    recommendedPositioning: {
      shouldPromise: ["Draft plans", "Assumption ranking", "Human-approved work item generation"],
      shouldNotPromise: ["Autonomous deployment", "Guaranteed business outcomes"],
      suggestedWording: "Use this MVP to turn rough business ideas into reviewable execution drafts."
    },
    nextEngineeringPriorities: [
      {
        title: "Wire schema validation into playbook completion",
        rationale: "Invalid AI output should fail before it mutates project state.",
        expectedImpact: "Higher trust in generated drafts",
        effort: "medium"
      }
    ]
  };
}

function sampleIdeaIntake(input = {}) {
  const oneLiner = textFromRequest(input);
  return {
    oneLiner,
    questions: [
      {
        id: "target_customer",
        text: "Who is the first user or buyer you can reach directly?",
        reason: "A first segment keeps the plan testable.",
        inputType: "short_text"
      },
      {
        id: "success_condition",
        text: "What would make the next two weeks a useful success?",
        reason: "The MVP loop needs a concrete learning target.",
        inputType: "long_text"
      }
    ]
  };
}

function sampleWeeklyReview(input = {}) {
  return {
    title: "Weekly review draft",
    summary: "Review the completed work, evidence gathered, and decisions that changed the plan.",
    learnings: [
      "The most useful output is the one the user can approve or reject quickly.",
      "Unverified assumptions should stay visible until evidence changes their status."
    ],
    nextActions: [
      "Approve one initiative for the next cycle",
      "Archive or revise assumptions that are no longer useful"
    ],
    sourceHash: stableHash(input)
  };
}

function generateSampleOutput(task, input = {}) {
  switch (task) {
    case "business_map_generation":
    case "metric_design":
    case "assumption_extraction":
      return sampleBusinessMap(input);
    case "initiative_generation":
    case "implementation_breakdown":
      return sampleInitiatives(input);
    case "engineering_state_analysis":
      return sampleEngineeringState(input);
    case "idea_intake":
      return sampleIdeaIntake(input);
    case "weekly_review":
      return sampleWeeklyReview(input);
    default:
      return {
        summary: "Deterministic sample output",
        task,
        sourceHash: stableHash(input)
      };
  }
}

function generateSampleLlmResponse(request = {}, route = {}) {
  const structured = generateSampleOutput(request.task, request);
  const content = request.responseFormat === "text"
    ? JSON.stringify(structured, null, 2)
    : JSON.stringify(structured);

  return {
    aiRunId: `sample_${stableHash({ request, route }).slice(0, 12)}`,
    provider: route.provider || "sample",
    model: route.model || "deterministic-sample",
    content,
    structured,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheHitTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0
    },
    warnings: ["sample_output"]
  };
}

module.exports = {
  stableHash,
  generateSampleOutput,
  generateSampleLlmResponse,
  sampleBusinessMap,
  sampleInitiatives,
  sampleEngineeringState,
  sampleIdeaIntake,
  sampleWeeklyReview
};
