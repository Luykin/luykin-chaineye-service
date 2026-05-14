import { PermissionGuard } from "@/components/permission/PermissionGuard";
import { LegacyEjsPartial } from "@/components/legacy/LegacyEjsPartial";
import nacosCampaignsHtml from "@/legacy/ejs/nacos-campaigns.ejs?raw";
import { registerLegacyNacosCampaigns } from "@/legacy/nacosCampaignsLegacy";

const wrappedNacosCampaignsHtml = `<div id="nacos-campaigns" class="tab-pane active">${nacosCampaignsHtml}</div>`;

export function NacosCampaignsPage() {
  return (
    <PermissionGuard permission="nacos_config">
      <LegacyEjsPartial html={wrappedNacosCampaignsHtml} tabId="nacos-campaigns" initialize={registerLegacyNacosCampaigns} />
    </PermissionGuard>
  );
}
