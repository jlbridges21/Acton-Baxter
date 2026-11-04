import { RegionsPage } from "@/components/configurator/admin/regions-page";
import { californiaCities } from "@/lib/configurator/location";

export default function ConfiguratorRegionsPage() {
  return <RegionsPage californiaCities={californiaCities()} />;
}
