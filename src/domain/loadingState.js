export const shouldShowBlockingSkeleton = (isLoading, content) => {
  const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content);
  return Boolean(isLoading) && !hasContent;
};

export const shouldShowUpdatingIndicator = (isLoading, content) => {
  const hasContent = Array.isArray(content) ? content.length > 0 : Boolean(content);
  return Boolean(isLoading) && hasContent;
};
