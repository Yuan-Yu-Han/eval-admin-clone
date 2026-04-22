import { PROJECT_PROFILES, VEHICLE_AGENT_PROJECT, VOICE_TICKET_PROJECT } from './projectProfiles.js';

export function defaultProjectAccess(demoAccessCode) {
  const [vehicleProfile, voiceProfile] = PROJECT_PROFILES;
  return [
    { code: 'eval', projectId: 'all', projectName: '管理员视角', role: 'admin' },
    { code: demoAccessCode, projectId: 'all', projectName: '管理员视角', role: 'admin' },
    { code: 'vehicle', ...vehicleProfile },
    { code: 'voice', ...voiceProfile },
    { code: 'ops', projectId: VOICE_TICKET_PROJECT, projectName: '语音工单结构化评测', role: 'member' },
    {
      code: 'tester',
      accountId: 'tester',
      accountName: '测试人员',
      projects: [
        { projectId: VEHICLE_AGENT_PROJECT, projectName: '车辆 Agent 评测', role: 'member' },
        { projectId: VOICE_TICKET_PROJECT, projectName: '语音工单结构化评测', role: 'member' }
      ]
    }
  ];
}
