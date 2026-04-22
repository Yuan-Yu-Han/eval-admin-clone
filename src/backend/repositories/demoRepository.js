export function createDemoRepository(state) {
  return {
    cases: state.cases,
    runs: state.runs,
    mockConfigs: state.mockConfigs,
    prompts: {
      keys: state.promptKeys,
      content: state.promptContent
    }
  };
}
