export const appClient = {
  functions: {
    invoke(name, body, options) {
      return new Promise((resolve) => {
        window.managementOverviewFixture.requests.push({ name, body, options, resolve });
      });
    },
  },
};
