export const POLICY_BUCKET = 'company-policies';
export const MAX_POLICY_BYTES = 20 * 1024 * 1024;

export async function validatePolicyPdf(file) {
  if (!file || !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
  if (file.size === 0 || file.size > MAX_POLICY_BYTES) {
    throw new Error('Choose a PDF between 1 byte and 20 MB.');
  }
  if (file.name.length > 255) throw new Error('Use a file name of up to 255 characters.');
  const signature = await file.slice(0, 5).text();
  if (signature !== '%PDF-') throw new Error('This file is not a valid PDF. Export it as a PDF and try again.');
}

// Keep this attempt across retries. A lost publication response must not create
// a second document or version, and a successful upload need not be repeated.
export async function publishPolicyPdf(client, employeeId, attempt) {
  const { file, title, description, requiresAcknowledgement, document, versionId } = attempt;
  if (!title.trim() || title.trim().length > 160) throw new Error('Enter a title of up to 160 characters.');
  if (description.length > 2000) throw new Error('Keep the description within 2,000 characters.');
  await validatePolicyPdf(file);
  const storage = client.storage.from(POLICY_BUCKET);
  if (!attempt.uploaded) {
    const { error } = await storage.upload(`${employeeId}/${versionId}.pdf`, file, {
      contentType: 'application/pdf', upsert: false, cacheControl: '0',
    });
    // A retry after an uncertain upload response can find the immutable object.
    const duplicate = error && (String(error.statusCode) === '409'
      || error.error === 'Duplicate' || error.message === 'The resource already exists');
    if (error && !duplicate) throw error;
    attempt.uploaded = true;
  }
  const { data, error } = await client.rpc('publish_policy', {
    target_document_id: document?.id || null,
    expected_version_id: document?.current_version_id || null,
    new_version_id: versionId,
    policy_title: title.trim(),
    policy_description: description.trim(),
    pdf_file_name: file.name,
    require_acknowledgement: requiresAcknowledgement,
  });
  if (error) throw error;
  const version = Array.isArray(data) ? data[0] : data;
  if (version?.id !== versionId) throw new Error('Publication could not be confirmed. Retry with the same PDF and details.');
  return version;
}

export function getPolicyAcknowledgement(data, versionId) {
  const acknowledgement = Array.isArray(data) ? data[0] : data;
  if (acknowledgement?.version_id !== versionId || !acknowledgement?.acknowledged_at) {
    throw new Error('Your acknowledgement could not be confirmed. Please try again.');
  }
  return acknowledgement;
}

export const policyNeedsAcknowledgement = (document, acknowledgedVersionIds) => (
  !document.archived_at && document.version.requires_acknowledgement
  && !acknowledgedVersionIds.has(document.current_version_id)
);

export const filterPolicies = (documents, search, filter, acknowledgedVersionIds) => {
  const query = search.trim().toLowerCase();
  return documents.filter((document) => {
    const matchesStatus = filter === 'archived' ? Boolean(document.archived_at)
      : !document.archived_at && (filter !== 'pending'
        || policyNeedsAcknowledgement(document, acknowledgedVersionIds));
    return matchesStatus && `${document.version.title} ${document.version.description}`.toLowerCase().includes(query);
  });
};
