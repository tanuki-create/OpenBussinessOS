"use strict";

function cleanIdea(input = {}) {
  return String(input.one_liner || input.oneLiner || input.idea || input.project?.one_liner || "スマホで事業計画から実装タスクまで作るOSS").trim();
}

function businessTypeFor(idea) {
  if (/社内|問い合わせ|業務|企業|B2B|SaaS/i.test(idea)) return "b2b_saas";
  if (/飲食|店舗|SNS|投稿/i.test(idea)) return "local_business_tool";
  if (/図面|建築|見積|施工|PDF/i.test(idea)) return "vertical_ai_workflow";
  return "early_stage_product";
}

function sampleIdeaIntake(input = {}) {
  const idea = cleanIdea(input);
  return {
    business_type: businessTypeFor(idea),
    initial_concept: idea,
    target_user_candidates: [
      "最初に強い痛みを持つ現場担当者",
      "導入判断を行う小規模チームの責任者"
    ],
    uncertainties: [
      { type: "customer", description: "誰が最初にお金や時間を払って検証するかが未確定です。" },
      { type: "solution", description: "AI支援の価値が既存運用より十分に速く伝わるかが未検証です。" },
      { type: "gtm", description: "最初の獲得チャネルと商談導線が未確定です。" }
    ],
    next_questions: [
      { question: "最初に使う人は誰ですか？", reason: "対象ユーザーが曖昧だと指標と施策が決まらないためです。", input_type: "short_text" },
      { question: "その人が今いちばん困っている作業は何ですか？", reason: "価値提案を作業単位に落とすためです。", input_type: "short_text" },
      { question: "2週間後に何が分かれば前進ですか？", reason: "施策を検証可能にするためです。", input_type: "short_text" }
    ]
  };
}

function sampleBusinessMap(input = {}) {
  const idea = cleanIdea(input);
  const type = businessTypeFor(idea);
  return {
    concept: {
      title: idea.length > 34 ? `${idea.slice(0, 34)}...` : idea,
      oneLiner: idea,
      description: `${idea}を、曖昧な構想ではなく検証可能な仮説、指標、2週間施策、実装タスクへ変換する。`,
      businessType: type
    },
    targetUsers: [
      {
        name: "初期導入に前向きな現場責任者",
        description: "手作業や属人運用に時間を取られ、短期間で改善効果を確認したい人。",
        painPoints: [
          "課題はあるが、何から検証すればよいか決めにくい",
          "施策と実装タスクが事業指標に結びつかない",
          "AI導入の費用対効果を説明しにくい"
        ],
        currentAlternatives: ["スプレッドシート", "Notion/Docs", "個別のAIチャット", "手作業の打ち合わせ"]
      }
    ],
    idealState: {
      description: "ユーザーがスマホから短い入力を重ねるだけで、次に実行すべき検証と作業が明確になっている。",
      horizon: "2週間",
      observableOutcomes: [
        "初回価値が10分以内に伝わる",
        "主要仮説と成功条件がカード化される",
        "WorkItemが実装可能な粒度で出力される"
      ]
    },
    northStarMetric: {
      name: "承認済み検証施策数",
      definition: "ユーザーがAI生成後に承認し、2週間以内に実行対象へ入れた施策の数。",
      whyItMatters: "構想が実行に変わったかを直接測れるため。",
      caveats: ["施策の質はReviewとEvidenceで別途確認する", "作業量だけを増やす指標にしない"]
    },
    assumptions: [
      {
        statement: "対象ユーザーは、長い事業計画よりも短い質問とカード承認を好む。",
        type: "customer",
        riskLevel: "high",
        evidenceLevel: "none",
        validationMethod: "5人へのオンボーディング観察と完了率測定"
      },
      {
        statement: "2週間施策とWorkItemが同時に出ると、構想から実行への移行が早くなる。",
        type: "solution",
        riskLevel: "medium",
        evidenceLevel: "weak",
        validationMethod: "サンプルプロジェクトで施策承認率と修正回数を測る"
      },
      {
        statement: "低コストモデルでもMVPの構造化出力には十分な品質を出せる。",
        type: "technical",
        riskLevel: "medium",
        evidenceLevel: "none",
        validationMethod: "同一入力でJSON妥当性と手直し量を比較する"
      }
    ],
    risks: [
      {
        title: "AI出力がもっともらしいだけになる",
        description: "EvidenceとDecisionを分けないと、未検証の推測が計画として扱われる。",
        severity: "high",
        mitigation: "各カードに evidenceLevel と承認状態を持たせる。"
      },
      {
        title: "コスト上限が見えず使い続けにくい",
        description: "AI実行ごとの推定費用がないとBYOK利用者が不安になる。",
        severity: "medium",
        mitigation: "Cost Ledgerと月次上限を最初から表示する。"
      }
    ],
    nextQuestions: [
      { question: "最初の検証相手を1種類に絞るなら誰ですか？", reason: "2週間施策の焦点を合わせるためです。", inputType: "short_text" },
      { question: "最初に見せたい成果物は何ですか？", reason: "実装WorkItemの粒度を決めるためです。", inputType: "short_text" }
    ]
  };
}

function sampleInitiatives(input = {}) {
  const map = input.businessMap || input.business_map || sampleBusinessMap(input);
  const assumption = map.assumptions?.[0]?.statement || "初期ユーザーが短い検証計画を必要としている";
  const metric = map.northStarMetric?.name || "承認済み検証施策数";

  return {
    initiatives: [
      {
        title: "初回価値を10分で見せる検証",
        description: "一文入力から事業マップと2週間施策を生成し、ユーザーが承認できる状態まで通す。",
        initiativeType: "product",
        relatedAssumption: assumption,
        relatedMetric: metric,
        hypothesis: "短い入力とカード承認で、初期ユーザーは事業構想を実行計画に変換できる。",
        successCriteria: "3件中2件以上のプロジェクトで、ユーザーが施策を1つ以上承認する。",
        timeboxDays: 14,
        priority: "high",
        workItems: [
          {
            title: "一文入力からBusiness Mapを生成する",
            description: "PoCで初回価値を10分以内に見せるため、Project作成後にBusiness Mapカードを生成する。",
            workType: "issue",
            acceptanceCriteria: [
              "Project作成後にConcept/Target/Pain/Metric/Assumptionが表示される",
              "生成結果はdraftとして保存される",
              "ユーザーがカードを承認できる"
            ],
            priority: "high"
          },
          {
            title: "2週間施策からWorkItemを作る",
            description: "施策が実行に移るよう、検証仮説と受け入れ条件を持つWorkItemを生成する。",
            workType: "issue",
            acceptanceCriteria: [
              "各WorkItemにWhyとAcceptance Criteriaがある",
              "関連する仮説と指標を辿れる",
              "Markdown exportに含まれる"
            ],
            priority: "high"
          }
        ]
      },
      {
        title: "コスト不安を減らすBYOK設定",
        description: "APIキーをサーバー側で暗号化し、月次上限と推定コストを常時確認できるようにする。",
        initiativeType: "security",
        relatedAssumption: "BYOK利用者はキー管理と費用上限が明確なら試しやすい。",
        relatedMetric: "月次AI実行コスト",
        hypothesis: "キーを返さずヒントだけ表示し、上限を見せると設定完了率が上がる。",
        successCriteria: "APIキー登録後、フロントに生キーが一度も返らず、cost summaryが更新される。",
        timeboxDays: 14,
        priority: "medium",
        workItems: [
          {
            title: "APIキー暗号化保存とkey hint表示を実装する",
            description: "機密情報をフロントへ返さないため、AES-GCMで保存し末尾ヒントだけを返す。",
            workType: "security",
            acceptanceCriteria: [
              "登録レスポンスにsecretやencrypted_keyが含まれない",
              "保存済みキーはLLM実行時のみ復号される",
              "監査ログにキー本文が残らない"
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
    summary: "MVPでは完全自動化ではなく、候補提示と人間承認のワークフローとして位置づけるのが安全です。",
    currentCapabilities: ["構造化カード生成", "Markdown export", "コスト推定"],
    limitations: [
      {
        area: "accuracy",
        description: "AI出力の事実性は入力情報に依存します。",
        businessImpact: "未検証仮説が確定事項として扱われるリスクがあります。",
        severity: "high"
      }
    ],
    recommendedPositioning: {
      shouldPromise: ["構想整理と検証計画の高速化", "人間承認前提の実行タスク化"],
      shouldNotPromise: ["完全自律経営判断", "外部ツールへの自動書き込み"],
      suggestedWording: "AIが提案し、人間が承認して実行へ移す事業OS"
    },
    nextEngineeringPriorities: [
      {
        title: "承認フローと監査ログを固める",
        rationale: "外部連携前の安全性を担保するため。",
        expectedImpact: "安心してWorkItemやIssue化を試せる。",
        effort: "medium"
      }
    ]
  };
}

function sampleForTask(task, input = {}) {
  if (task === "idea_intake") return sampleIdeaIntake(input);
  if (task === "initiative_generation" || task === "implementation_breakdown") return sampleInitiatives(input);
  if (task === "engineering_state_analysis") return sampleEngineeringState(input);
  return sampleBusinessMap(input);
}

module.exports = {
  sampleBusinessMap,
  sampleEngineeringState,
  sampleForTask,
  sampleIdeaIntake,
  sampleInitiatives
};
