export interface ReviewSearchItem {
  id: string;
  reviewer: {
    username: string;
    displayName: string;
    avatar?: string;
  };
  targetHandle: string;
  rating: number;
  tags: string[];
  comment: string;
  createdAt: string;
}

export interface ReviewsSearchResponse {
  success: boolean;
  data: {
    targetAccount: {
      handle: string;
      displayName?: string | null;
      avatar?: string | null;
    };
    reviews: ReviewSearchItem[];
    total: number;
  };
}

export interface ReviewDeleteResponse {
  success: boolean;
  message?: string;
  data?: {
    reviewId: string;
  };
}
