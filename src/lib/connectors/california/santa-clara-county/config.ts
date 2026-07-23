export const SANTA_CLARA_COUNTY_CONFIG = {
  key: "ca-santa-clara-county",
  name: "Santa Clara County",
  parcels: {
    url: "https://services8.arcgis.com/fpjs8A5Vtkshblnd/arcgis/rest/services/Santa_Clara_County_Parcels/FeatureServer/0",
    fields: {
      apn: "apn",
      city: "situs_city",
      house: "situs_hous",
      streetDir: "situs_stre",
      streetName: "situs_st_1",
      streetType: "situs_st_2",
      zip: "situs_zip_",
      state: "situs_stat",
      taxRateArea: "tax_rate_a",
      shapeArea: "shape_area",
    },
  },
  propertyProfile: {
    experienceUrl: "https://experience.arcgis.com/experience/b6175d89a38649a898e409d44f3da90b",
    legacyProfileUrl: "https://sccdpdapps.com/profile/",
    assessorSearchUrl: "https://www.sccassessor.org/index.php/online-services/property-search",
  },
} as const;

export type PropertyProfileAccessType =
  "direct_report" | "deep_link" | "generic_search" | "recreated_from_layers" | "unavailable";
