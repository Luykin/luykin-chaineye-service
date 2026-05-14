import { apiRequest } from "./apiClient";
import type { ReviewDeleteResponse, ReviewsSearchResponse } from "@/types/reviews";

export async function searchReviewsByHandle(handle: string) {
  const query = new URLSearchParams({ handle });
  return apiRequest<ReviewsSearchResponse>(`/api/admin/reviews?${query.toString()}`);
}

export async function deleteReview(reviewId: string) {
  return apiRequest<ReviewDeleteResponse>("/api/admin/reviews/delete", {
    method: "POST",
    body: { reviewId },
  });
}
