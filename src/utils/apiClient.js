export const apiClient = async (url, options = {}) => {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`API Error ${response.status}: ${errorText}`);
      err.status = response.status; 
      throw err;
    }

    return await response.json();
  } catch (error) {
    console.error("Network or Parsing Error:", error);
    throw error; 
  }
};