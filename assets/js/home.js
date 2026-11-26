
import {
    getStoreData,
    getActiveInvitations
} from "./data.js";

import {
    preloadInvitationTemplates
} from "./template-renderer.js";


try {
    const data = await getStoreData();
    const active = getActiveInvitations(data);

    console.time("HOMEPAGE SVG PRELOAD");

    preloadInvitationTemplates(active)
        .then(() => {
            console.timeEnd("HOMEPAGE SVG PRELOAD");
        })
        .catch(error => {
            console.warn("Invitation preloading failed:", error);
        });

} catch (error) {
    console.error("Homepage initialization failed:", error);
}
