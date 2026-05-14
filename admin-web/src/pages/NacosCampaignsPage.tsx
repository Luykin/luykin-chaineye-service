import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyEjsPartial } from "@/components/legacy/LegacyEjsPartial";
import nacosCampaignsHtml from "../../../src/xhunt/views/partials/nacos-campaigns.ejs?raw";

const wrappedNacosCampaignsHtml = `<div id="nacos-campaigns" class="tab-pane active">${nacosCampaignsHtml}</div>`;

export function NacosCampaignsPage() {
  return (
    <PermissionGuard permission="nacos_config">
      <LegacyEjsPartial html={wrappedNacosCampaignsHtml} tabId="nacos-campaigns" />
    </PermissionGuard>
  );
}
