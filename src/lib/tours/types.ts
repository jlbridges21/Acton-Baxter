export type TourUploadStage = "queued" | "processing" | "uploading" | "saving" | "done" | "error";

export type TourSummary = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  isPublic: boolean;
  projectNumber: string | null;
  createdAt: string;
  ownerId: string;
  ownerName: string;
  sceneCount: number;
  coverUrl: string | null;
};

export type TourScene = {
  id: string;
  tourId: string;
  name: string;
  position: number;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
};

export type TourDetail = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  isPublic: boolean;
  scenes: TourScene[];
};
