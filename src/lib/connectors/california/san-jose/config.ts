export const SAN_JOSE_CONFIG = {
  key: "ca-san-jose",
  name: "City of San Jose",
  openDataMapServer:
    "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer",
  layers: {
    parcels: {
      id: 270,
      url: "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/270",
      fields: {
        apn: "APN",
        parcelId: "PARCELID",
        lotNumber: "LOTNUM",
      },
    },
    zoning: {
      id: 401,
      url: "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/401",
      fields: {
        zoning: "ZONING",
        zoningAbbrev: "ZONINGABBREV",
      },
    },
    generalPlan: {
      id: 404,
      url: "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/404",
      fields: {
        designation: "GPDESIGNATION",
      },
    },
    historicResources: {
      id: 406,
      url: "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/406",
      fields: {
        name: "NAME",
        status: "STATUS",
      },
    },
    historicArea: {
      id: 408,
      url: "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer/408",
      fields: {
        name: "NAME",
      },
    },
  },
  links: {
    zoningMap: "https://gisdata-csj.opendata.arcgis.com/datasets/CSJ::zoning-districts",
    permitSearch:
      "https://www.sanjoseca.gov/your-government/departments-offices/planning-building-code-enforcement/building-permits",
    parcelsOpenData: "https://data.sanjoseca.gov/dataset/parcels",
  },
} as const;
