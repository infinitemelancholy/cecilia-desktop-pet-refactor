import unittest
from measure_running_keys import merge_iris_components
class IrisGrouping(unittest.TestCase):
    def test_split_highlight_never_turns_two_right_eye_pieces_into_two_eyes(self):
        points=merge_iris_components([(1235.57,635.2,30),(1246.12,634.94,16),(1285,626.18,34),(1295.08,624.55,49),(1293.5,618,4)],475)
        self.assertAlmostEqual(points[0][0],1239.239565,places=4);self.assertGreater(points[1][0]-points[0][0],45)
    def test_one_eye_or_clusters_too_near_are_refused(self):
        for values in [[(100,80,40),(110,80,49)],[]]:
            with self.assertRaises(ValueError):merge_iris_components(values,475)
if __name__=='__main__':unittest.main()
