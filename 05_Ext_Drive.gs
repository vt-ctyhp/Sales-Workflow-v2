const DriveExt = Object.freeze({
  ensureFolder: function(parentId, name) {
    var existing = extReadStore_('driveFolders').filter(function(row) {
      return row.ParentId === parentId && row.Name === name;
    })[0];
    if (existing) {
      return extResponse_(existing, existing.Version || null);
    }
    var folder = {
      FolderID: extGeneratedId_('folder'),
      ParentId: parentId || '',
      Name: name,
      Url: 'https://drive.google.com/drive/folders/' + extGeneratedId_('test'),
      CreatedAt: extNow_(),
      Version: 1,
      Mode: 'property-backed',
    };
    extAppendRow_('driveFolders', folder);
    return extMutationResponse_(folder, []);
  },
  listNewFiles: function(folderId, since) {
    var sinceComparable = since ? extComparable_(since) : 0;
    var rows = extReadStore_('driveFiles').filter(function(row) {
      return row.FolderID === folderId && extComparable_(row.CreatedAt) >= sinceComparable;
    });
    return extResponse_(rows, null);
  },
});

function driveExtRegisterTestFile_(folderId, file) {
  var row = mergeObjects_(file || {}, {
    FileID: file && file.FileID || extGeneratedId_('file'),
    FolderID: folderId,
    Name: file && file.Name || 'Test upload',
    Url: file && file.Url || 'https://drive.google.com/file/d/test',
    CreatedAt: file && file.CreatedAt || extNow_(),
  });
  extAppendRow_('driveFiles', row);
  return extMutationResponse_(row, []);
}
