// Replace with the published CSV URLs for each tab. Do not publish the private Orders sheet.
export const CONFIG = {
  sheets: {
    invitations: "https://docs.google.com/spreadsheets/d/e/REPLACE_WITH_PUBLISHED_ID/pub?gid=0&single=true&output=csv",
    options: "https://docs.google.com/spreadsheets/d/e/REPLACE_WITH_PUBLISHED_ID/pub?gid=1&single=true&output=csv"
  },
  backendUrl: "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec",
  currency: "USD",
  sampleMode: true
};