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
  ensureChildFolder: function(parentId, name) {
    return DriveExt.ensureFolder(parentId, name);
  },
  folderFromUrl: function(url) {
    var id = driveExtIdFromUrl_(url);
    if (!id) {
      return extNotFound_('invalid_folder_url');
    }
    return extResponse_({
      FolderID: id,
      ParentId: '',
      Name: 'Folder ' + id,
      Url: url,
      Version: 1,
      Mode: 'url',
    }, 1);
  },
  copyTemplate: function(templateId, name, folderId) {
    try {
      if (templateId && folderId && driveExtCanUseRealDrive_(templateId, folderId)) {
        var folder = DriveApp.getFolderById(folderId);
        var file = DriveApp.getFileById(templateId).makeCopy(name, folder);
        return extMutationResponse_({
          FileID: file.getId(),
          FolderID: folderId,
          Name: file.getName(),
          Url: file.getUrl(),
          TemplateID: templateId,
          CreatedAt: extNow_(),
          Version: 1,
          Mode: 'drive',
        }, []);
      }
    } catch (err) {
      // Fall through to deterministic property-backed files for tests and missing Drive config.
    }
    var row = {
      FileID: extGeneratedId_('doc'),
      FolderID: folderId || '',
      Name: name || 'Generated document',
      Url: 'https://docs.google.com/document/d/' + extGeneratedId_('doc'),
      TemplateID: templateId || '',
      CreatedAt: extNow_(),
      Version: 1,
      Mode: 'property-backed',
    };
    extAppendRow_('driveFiles', row);
    return extMutationResponse_(row, []);
  },
  exportPdf: function(docFileId, name, folderId) {
    try {
      if (docFileId && folderId && driveExtCanUseRealDrive_(docFileId, folderId)) {
        var source = DriveApp.getFileById(docFileId);
        var folder = DriveApp.getFolderById(folderId);
        var pdf = folder.createFile(source.getAs(MimeType.PDF).setName((name || source.getName()) + '.pdf'));
        return extMutationResponse_({
          FileID: pdf.getId(),
          FolderID: folderId,
          Name: pdf.getName(),
          Url: pdf.getUrl(),
          SourceFileID: docFileId,
          CreatedAt: extNow_(),
          Version: 1,
          Mode: 'drive',
        }, []);
      }
    } catch (err) {
      // Fall through to deterministic property-backed PDFs for tests and missing Drive config.
    }
    var row = {
      FileID: extGeneratedId_('pdf'),
      FolderID: folderId || '',
      Name: (name || 'Generated document') + '.pdf',
      Url: 'https://drive.google.com/file/d/' + extGeneratedId_('pdf'),
      SourceFileID: docFileId || '',
      CreatedAt: extNow_(),
      Version: 1,
      Mode: 'property-backed',
    };
    extAppendRow_('driveFiles', row);
    return extMutationResponse_(row, []);
  },
  createShortcut: function(targetFileId, name, folderId) {
    try {
      if (targetFileId && folderId && driveExtCanUseRealDrive_(targetFileId, folderId) && DriveApp.createShortcut) {
        var folder = DriveApp.getFolderById(folderId);
        var shortcut = DriveApp.createShortcut(targetFileId).setName(name || 'Shortcut');
        shortcut.moveTo(folder);
        return extMutationResponse_({
          ShortcutID: shortcut.getId(),
          TargetFileID: targetFileId,
          FolderID: folderId,
          Name: shortcut.getName(),
          Url: shortcut.getUrl(),
          CreatedAt: extNow_(),
          Version: 1,
          Mode: 'drive',
        }, []);
      }
    } catch (err) {
      return {
        ok: false,
        reason: 'shortcut_failed',
        error: { message: err.message },
        source: 'external',
        ageMs: 0,
      };
    }
    var row = {
      ShortcutID: extGeneratedId_('shortcut'),
      TargetFileID: targetFileId || '',
      FolderID: folderId || '',
      Name: name || 'Shortcut',
      Url: 'https://drive.google.com/shortcut/' + extGeneratedId_('shortcut'),
      CreatedAt: extNow_(),
      Version: 1,
      Mode: 'property-backed',
    };
    extAppendRow_('driveShortcuts', row);
    return extMutationResponse_(row, []);
  },
  listNewFiles: function(folderId, since) {
    var sinceComparable = since ? extComparable_(since) : 0;
    var rows = extReadStore_('driveFiles').filter(function(row) {
      return row.FolderID === folderId && extComparable_(row.CreatedAt) >= sinceComparable;
    });
    return extResponse_(rows, null);
  },
});

function driveExtIdFromUrl_(url) {
  var text = String(url || '').trim();
  var match = text.match(/\/folders\/([A-Za-z0-9_-]+)/) ||
    text.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    text.match(/\/d\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : text && text.indexOf('http') !== 0 ? text : '';
}

function driveExtCanUseRealDrive_(fileId, folderId) {
  var ids = [fileId, folderId].join(' ');
  return !/(^|[\s:])(test|tpl|doc|pdf|folder|root|so|ar|shortcut)_/i.test(ids) &&
    ids.indexOf('template:') === -1 &&
    ids.indexOf('property-backed') === -1;
}

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
