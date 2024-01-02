export class CustomError extends Error {
  url?: string
  fetchParams?: any
  response?: any
  errors?: any

  constructor(
    message: string,
    {
      url,
      fetchParams,
      response,
      errors,
      cause,
    }: {
      url: string
      fetchParams?: any
      response?: any
      errors?: any
      cause?: any
    }
  ) {
    super(message, {...(cause && {cause})})
    if (url) {
      this.url = url
    }
    if (fetchParams) {
      this.fetchParams = fetchParams
    }
    if (response) {
      this.response = response
    }
    if (errors) {
      this.errors = errors
    }
  }
}
