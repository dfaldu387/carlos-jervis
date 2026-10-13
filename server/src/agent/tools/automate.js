import { automateMode, findFlow, publicFlows } from '../../automate/index.js';

/**
 * Power Automate tool.
 *
 * Deliberately side-effect free: it resolves the flow the user named and
 * returns a *proposal* the orchestrator attaches as `result.automation`.
 * Starting the flow is a separate, confirmed call to POST /api/automate/trigger,
 * so a chat message can never run a flow by itself.
 */
export const automateTrigger = {
  id: 'automate.trigger',
  source: 'power_automate',
  label: 'Power Automate flow',
  description: 'Propose an approved Power Automate flow to start; the user confirms before anything runs.',
  permission: 'automate:run',
  async run({ interpretation, flow, payload } = {}) {
    const mode = automateMode();
    const query = String(flow ?? interpretation?.entities?.flow ?? interpretation?.entities?.flowName ?? '').trim();
    const match = query ? findFlow(query) : null;
    const details = payload ?? interpretation?.entities?.flowPayload ?? {};
    const available = publicFlows();

    if (!match) {
      return {
        data: { automation: null, query, available, mode },
        citation: { source: 'power_automate', object: 'flows', detail: query ? `no flow matched "${query}"` : 'no flow named' },
      };
    }
    return {
      data: {
        automation: { flow: match.name, label: match.label, payload: details, status: 'proposed', mode },
        query,
        available,
        mode,
      },
      citation: { source: 'power_automate', object: match.name, detail: `proposed ${match.label} (${mode})` },
    };
  },
};
