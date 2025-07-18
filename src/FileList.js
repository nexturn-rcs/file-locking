import React, { useState, useEffect } from "react";
import { Pagination } from "antd";
import "./FileList.css";
import { getUserFromToken } from "./auth";

const ITEMS_PER_PAGE = 8;
const API_BASE_URL = "https://w4bnr926gc.execute-api.us-east-2.amazonaws.com/Prod";

const FileList = () => {
  const [files, setFiles] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const userInfo = getUserFromToken();
    if (userInfo) setUser(userInfo);

    setLoading(true);

    const fetchS3Files = fetch(
      `${API_BASE_URL}/s3-files`
    ).then((res) => res.json());

    const fetchLocks = fetch(
      `${API_BASE_URL}/list`
    ).then((res) => res.json());

    Promise.all([fetchS3Files, fetchLocks])
      .then(([s3Files, lockData]) => {
        // Convert lock data to a map for quick lookup
        const lockMap = {};
        lockData.forEach((item) => {
          lockMap[item.filename] = {
            locked: item.status === "locked",
            lockedBy: item.locked_by || null,
            timestamp: item.timestamp || null,
          };
        });

        const mergedFiles = s3Files.map((fileName) => ({
          fileName,
          locked: lockMap[fileName]?.locked || false,
          lockedBy: lockMap[fileName]?.lockedBy || null,
          timestamp: lockMap[fileName]?.timestamp || null,

        }));

        setFiles(mergedFiles);
      })
      .catch((err) => {
        console.error("Failed to fetch files:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleLockToggle = async (indexOnPage) => {
    const index = (currentPage - 1) * ITEMS_PER_PAGE + indexOnPage;
    const updatedFiles = [...files];
    const file = updatedFiles[index];

    if (!user) {
      alert("User not authenticated");
      return;
    }

    if (file.locked) {
      try {
        const response = await fetch(`${API_BASE_URL}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.fileName }),
        });

        if (response.ok) {
          file.locked = false;
          file.lockedBy = null;
          setFiles(updatedFiles);
        } else {
          console.error("Unlock failed");
        }
      } catch (error) {
        console.error("Error unlocking file:", error);
      }
    } else {
      try {
        const response = await fetch(`${API_BASE_URL}/lock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.fileName, user: user.email }),
        });

        if (response.ok) {
          file.locked = true;
          file.lockedBy = user.email;
          setFiles(updatedFiles);
        } else {
          console.error("Lock failed");
        }
      } catch (error) {
        console.error("Error locking file:", error);
      }
    }
  };

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedFiles = files.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <div className="file-container">
      <h1>S3 File Manager</h1>
      <h2>Files in S3 Bucket</h2>

      {loading ? (
        <div className="custom-loader">
          <div className="spinner"></div>
          <div className="loader-text">Please Wait...</div>
        </div>
      ) : files.length === 0 ? (
        <div className="no-files-message">No files found</div>
      ) : (
        <>
          <table className="file-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Locked</th>
                <th>Locked By</th>
                <th>Locked Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFiles.map((file, index) => (
                <tr key={file.fileName}>
                  <td>{file.fileName}</td>
                  <td>{file.locked ? "Yes" : "No"}</td>
                  <td>{file.locked ? `Locked by ${file.lockedBy}` : "-"}</td>
                  <td>
                    {file.locked && file.timestamp
                      ? new Date(file.timestamp).toLocaleDateString("en-US", {
                          year: "2-digit",
                          month: "2-digit",
                          day: "2-digit",
                        })
                      : "-"}
                  </td>

                  <td>
                    <button
                      className={file.locked ? "unlock-btn" : "lock-btn"}
                      onClick={() => handleLockToggle(index)}
                    >
                      {file.locked ? "Unlock" : "Lock"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {files.length > ITEMS_PER_PAGE && (
            <div className="pagination-container">
              <Pagination
                current={currentPage}
                pageSize={ITEMS_PER_PAGE}
                total={files.length}
                onChange={(page) => setCurrentPage(page)}
                showSizeChanger={false}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FileList;
