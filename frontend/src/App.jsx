import { useState } from "react";
import "./App.css";
import GridTableView from "./GridTableView";

// Helper function to generate a stable random color based on a course name
const generateColor = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360; // Convert hash to a hue value
  return `hsl(${hue}, 70%, 80%)`; // Keep a light color tone
};

// Tag component for displaying and removing courses
const Tag = ({ course, onRemove }) => {
  const tagStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    margin: "5px",
    borderRadius: "15px",
    backgroundColor: generateColor(course),
    color: "#000",
    cursor: "pointer",
    fontSize: "14px",
  };

  return (
    <div style={tagStyle} onClick={() => onRemove(course)}>
      {course}
      <span style={{ marginLeft: "5px", fontWeight: "bold" }}>×</span>
    </div>
  );
};

const App = () => {
  const [courseInput, setCourseInput] = useState("");
  const [courseSuggestions, setCourseSuggestions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [dataSheet, setDataSheet] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [timeSlots, setTimeSlots] = useState([]);
  const [viewMode, setViewMode] = useState("list");

  const handleInputChange = async (e) => {
    const query = e.target.value;
    setCourseInput(query);

    if (query.length < 2) {
      setCourseSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `http://127.0.0.1:8000/courses?query=${query}`
      );
      if (!response.ok) throw new Error("Failed to fetch suggestions");

      const data = await response.json();
      setCourseSuggestions(data);
    } catch (error) {
      console.error("Error fetching course suggestions:", error);
      setCourseSuggestions([]);
    }
  };

  const handleSelectCourse = (course) => {
    const courseText = `${course.code} - ${course.name}`;
    if (!courses.includes(courseText)) {
      setCourses([...courses, courseText]);
    }
    setCourseInput("");
    setCourseSuggestions([]);
  };

  const handleRemoveCourse = (courseToRemove) => {
    setCourses(courses.filter((course) => course !== courseToRemove));
    setDataSheet([]); // Clear data sheet
    setTimeSlots([]); // Clear time slots
  };

  const fetchDataSheet = async () => {
    setError("");
    setIsLoading(true);
    try {
      const courseCodes = courses.map((course) => course.split(" - ")[0]);
      const response = await fetch(
        `http://127.0.0.1:8000/datesheet?courses=${courseCodes.join(",")}`,
        {
          method: "GET",
        }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch data sheet");
      }
      const data = await response.json();
      setDataSheet(data.data_sheet);
      setTimeSlots(data.time_slots);
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto bg-white shadow-lg rounded-lg">
      <h1 className="text-2xl font-bold mb-4 text-center">Date Sheet Generator</h1>

      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Search courses..."
          value={courseInput}
          onChange={handleInputChange}
          className="border p-2 rounded w-full shadow-sm"
        />
        {courseSuggestions.length > 0 && (
          <ul className="absolute left-0 right-0 bg-white border rounded shadow-md max-h-40 overflow-y-auto z-10">
            {courseSuggestions.map((course, index) => (
              <li
                key={index}
                onClick={() => handleSelectCourse(course)}
                className="cursor-pointer p-2 hover:bg-gray-200"
              >
                {course.code} - {course.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4">
        <h2 className="text-lg font-semibold">Selected Courses:</h2>
        {courses.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-2">
            {courses.map((course, index) => (
              <Tag key={index} course={course} onRemove={handleRemoveCourse} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 mt-2">No courses selected</p>
        )}
      </div>

      <button
        onClick={fetchDataSheet}
        disabled={isLoading || courses.length === 0}
        className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded shadow w-full disabled:bg-gray-400"
      >
        {isLoading ? "Generating..." : "Generate Date Sheet"}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-center">
          {error}
        </div>
      )}

      <div className="flex justify-center my-4">
        <button
          onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
          disabled={dataSheet.length === 0}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded shadow disabled:bg-gray-400"
        >
          Toggle View
        </button>
      </div>

      {dataSheet.length > 0 ? (
        viewMode === "list" ? (
          <div className="mt-6 bg-gray-100 p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">Generated Date Sheet:</h2>
            {isLoading ? (
              <p className="text-center">Loading...</p>
            ) : (
              <table className="min-w-full bg-white border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    {Object.keys(dataSheet[0] || {}).map((key) => (
                      <th key={key} className="border p-2 font-bold">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataSheet.map((row, index) => (
                    <tr key={index} className={index % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      {Object.values(row).map((value, i) => (
                        <td key={i} className="border p-2">{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="mt-6 bg-gray-100 p-4 rounded shadow">
            <h2 className="text-lg font-semibold mb-2">Grid View:</h2>
            {isLoading ? (
              <p className="text-center">Loading...</p>
            ) : (
              <GridTableView dataSheet={dataSheet} timeSlots={timeSlots} />
            )}
          </div>
        )
      ) : (
        <p className="text-center text-gray-500 mt-4">No data available</p>
      )}
    </div>
  );
};

export default App;
